'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AlertTriangle } from 'lucide-react';
import type {
  BedTierFilter,
  CameraPreset,
  CampusColorMode,
  CampusKtxNode,
  CampusRoomNode,
  FunctionalAreaNode,
  HoverInfo,
  RenderPerfStats,
  RoomBedSlot,
  SceneTheme,
  UnitXRayFilter,
  ViewLevel,
} from '../types';
import {
  applyCampusColorMode,
  buildCampusScene,
  type RoomVisualHandle,
} from '../scene/campusBuilder';
import {
  applyBedHighlights,
  buildRoomInteriorScene,
  type BedVisualHandle,
} from '../scene/roomBuilder';
import { CAMPUS_BLUEPRINT_CONFIG } from '../scene/campusLayoutConfig';
import { disposeObject3D } from '../scene/materials';

export interface Ktx3DViewportHandle {
  captureSnapshot: () => string | null;
}

interface Ktx3DViewportProps {
  viewLevel: ViewLevel;
  sceneTheme: SceneTheme;
  campusScopeKey: string;
  ktxNodes: CampusKtxNode[];
  colorMode: CampusColorMode;
  unitXRayFilter: UnitXRayFilter | null;
  focusedRoomKey: string | null;
  hideRoofs: boolean;
  showFunctionalRooms: boolean;
  activeRoom: CampusRoomNode | null;
  activeRoomBeds: RoomBedSlot[];
  selectedBedId: string | null;
  bedTierFilter: BedTierFilter;
  showBedNames: boolean;
  cameraPresetRequest: { preset: CameraPreset; seq: number } | null;
  focusRoomRequest: { roomKey: string; seq: number } | null;
  focusBedRequest: { bedId: string; seq: number } | null;
  zoomRequest: { factor: number; seq: number } | null;
  onSelectRoom: (room: CampusRoomNode) => void;
  onSelectBed: (bed: RoomBedSlot | null) => void;
  onHoverChange: (info: HoverInfo | null) => void;
  onPerfStats?: (stats: RenderPerfStats) => void;
}

// Pre-allocated scratch helpers (Zero GC inside render loop)
const _pointerNdc = new THREE.Vector2();
const _desiredCamPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _offsetVec = new THREE.Vector3();

function detectSoftwareWebGL(): { supported: boolean; isSoftwareGl: boolean } {
  if (typeof document === 'undefined') return { supported: false, isSoftwareGl: true };
  try {
    const probeCanvas = document.createElement('canvas');
    const gl =
      (probeCanvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (probeCanvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return { supported: false, isSoftwareGl: true };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return { supported: true, isSoftwareGl };
  } catch {
    return { supported: false, isSoftwareGl: true };
  }
}

function getThemeBgHex(theme: SceneTheme): number {
  return theme === 'light' ? 0xdbe7f5 : 0x0b1220;
}

function computeCameraForPreset(
  viewLevel: ViewLevel,
  preset: CameraPreset,
  center: THREE.Vector3,
  radius: number,
  outPos: THREE.Vector3,
  outTarget: THREE.Vector3
) {
  outTarget.copy(center);
  if (viewLevel === 'campus') {
    const dist = Math.max(22, radius * 1.38);
    if (preset === 'top') {
      outPos.set(center.x, center.y + dist * 1.25, center.z + 0.01);
    } else if (preset === 'low') {
      outPos.set(
        center.x + dist * 0.58,
        center.y + Math.max(7, radius * 0.34),
        center.z + dist * 0.72
      );
    } else {
      outPos.set(center.x + dist * 0.55, center.y + dist * 0.68, center.z + dist * 0.85);
    }
    return;
  }

  const dist = Math.max(8.5, radius * 1.48);
  if (preset === 'top') {
    outPos.set(center.x, center.y + dist * 1.18, center.z + 0.01);
  } else if (preset === 'left_row') {
    outTarget.set(center.x - 1.5, 1.1, center.z);
    outPos.set(center.x + dist * 0.55, center.y + 2.4, center.z + dist * 0.52);
  } else if (preset === 'right_row') {
    outTarget.set(center.x + 1.5, 1.1, center.z);
    outPos.set(center.x - dist * 0.55, center.y + 2.4, center.z + dist * 0.52);
  } else if (preset === 'low') {
    outPos.set(center.x, 1.75, center.z + dist * 0.92);
  } else {
    outPos.set(center.x + dist * 0.38, center.y + dist * 0.64, center.z + dist * 0.92);
  }
}

const Ktx3DViewport = forwardRef<Ktx3DViewportHandle, Ktx3DViewportProps>(function Ktx3DViewport(
  {
    viewLevel,
    sceneTheme,
    campusScopeKey,
    ktxNodes,
    colorMode,
    unitXRayFilter,
    focusedRoomKey,
    hideRoofs,
    showFunctionalRooms,
    activeRoom,
    activeRoomBeds,
    selectedBedId,
    bedTierFilter,
    showBedNames,
    cameraPresetRequest,
    focusRoomRequest,
    focusBedRequest,
    zoomRequest,
    onSelectRoom,
    onSelectBed,
    onHoverChange,
    onPerfStats,
  },
  ref
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglUnsupported, setWebglUnsupported] = useState(false);

  const callbacksRef = useRef({ onSelectRoom, onSelectBed, onHoverChange, onPerfStats });
  callbacksRef.current = { onSelectRoom, onSelectBed, onHoverChange, onPerfStats };

  const stateRef = useRef({
    viewLevel,
    sceneTheme,
    colorMode,
    unitXRayFilter,
    focusedRoomKey,
    hideRoofs,
    showFunctionalRooms,
    selectedBedId,
    bedTierFilter,
  });
  stateRef.current = {
    viewLevel,
    sceneTheme,
    colorMode,
    unitXRayFilter,
    focusedRoomKey,
    hideRoofs,
    showFunctionalRooms,
    selectedBedId,
    bedTierFilter,
  };

  const engineRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    hemiLight: THREE.HemisphereLight;
    keyLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    contentRoot: THREE.Group;
    roofsGroup: THREE.Group | null;
    functionalGroup: THREE.Group | null;
    isSoftwareGl: boolean;
    maxAnisotropy: number;
    hitTargets: THREE.Object3D[];
    functionalHitTargets: THREE.Object3D[];
    roomVisuals: Map<string, RoomVisualHandle>;
    functionalLookup: Map<string, FunctionalAreaNode>;
    bedVisuals: Map<string, BedVisualHandle>;
    boundsCenter: THREE.Vector3;
    boundsRadius: number;
    hoveredRoomKey: string | null;
    hoveredBedId: string | null;
    lastCameraScopeKey: string | null;
    cameraTransition: {
      active: boolean;
      targetPos: THREE.Vector3;
      targetLook: THREE.Vector3;
    };
    requestRender: () => void;
  } | null>(null);

  // Expose synchronous HUD-free PNG Snapshot export (zero preserveDrawingBuffer perf overhead)
  useImperativeHandle(
    ref,
    () => ({
      captureSnapshot: () => {
        const eng = engineRef.current;
        if (!eng) return null;
        try {
          eng.controls.update();
          eng.renderer.render(eng.scene, eng.camera);
          return eng.renderer.domElement.toDataURL('image/png');
        } catch (err) {
          console.warn('[ktx-3d-test] captureSnapshot error:', err);
          return null;
        }
      },
    }),
    []
  );

  // ── 1. Initialize WebGLRenderer, RoomEnvironment, Studio Lighting & OrbitControls ONCE ──
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { supported, isSoftwareGl } = detectSoftwareWebGL();
    if (!supported) {
      setWebglUnsupported(true);
      return;
    }

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);

    const scene = new THREE.Scene();
    const initBg = getThemeBgHex(stateRef.current.sceneTheme);
    scene.background = new THREE.Color(initBg);
    scene.fog = new THREE.FogExp2(initBg, 0.0055);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.15, 420);
    // Enable layer 2 on camera so dimmed ghost bunks render transparently while raycaster (layer 0) passes right through them!
    camera.layers.enable(2);
    camera.position.set(24, 24, 30);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.outline = 'none';
    container.appendChild(renderer.domElement);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    // Procedural Studio RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    // Warm/Cool 3-point lighting rig
    const hemiLight = new THREE.HemisphereLight(0xcbd5e1, 0x1e293b, 0.78);
    hemiLight.position.set(0, 60, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5e4, 1.55);
    keyLight.position.set(32, 48, 28);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 160;
    keyLight.shadow.camera.left = -45;
    keyLight.shadow.camera.right = 45;
    keyLight.shadow.camera.top = 45;
    keyLight.shadow.camera.bottom = -45;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.025;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.55);
    rimLight.position.set(-28, 22, -26);
    scene.add(rimLight);

    const contentRoot = new THREE.Group();
    contentRoot.name = 'ktx-dynamic-content';
    scene.add(contentRoot);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 3.2;
    controls.maxDistance = 190;
    controls.screenSpacePanning = true;

    const cameraTransition = {
      active: false,
      targetPos: new THREE.Vector3(),
      targetLook: new THREE.Vector3(),
    };

    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;
    let lastTickTs = performance.now();
    let lastPerfReportTs = 0;

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = window.requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;

        const now = performance.now();
        const delta = Math.min(0.08, Math.max(0.001, (now - lastTickTs) / 1000));
        lastTickTs = now;

        let needsAnotherFrame = false;
        if (cameraTransition.active) {
          if (isSoftwareGl) {
            camera.position.copy(cameraTransition.targetPos);
            controls.target.copy(cameraTransition.targetLook);
            cameraTransition.active = false;
          } else {
            const lambda = 7.5;
            camera.position.x = THREE.MathUtils.damp(camera.position.x, cameraTransition.targetPos.x, lambda, delta);
            camera.position.y = THREE.MathUtils.damp(camera.position.y, cameraTransition.targetPos.y, lambda, delta);
            camera.position.z = THREE.MathUtils.damp(camera.position.z, cameraTransition.targetPos.z, lambda, delta);
            controls.target.x = THREE.MathUtils.damp(controls.target.x, cameraTransition.targetLook.x, lambda, delta);
            controls.target.y = THREE.MathUtils.damp(controls.target.y, cameraTransition.targetLook.y, lambda, delta);
            controls.target.z = THREE.MathUtils.damp(controls.target.z, cameraTransition.targetLook.z, lambda, delta);

            const posDist = camera.position.distanceTo(cameraTransition.targetPos);
            const lookDist = controls.target.distanceTo(cameraTransition.targetLook);
            if (posDist < 0.04 && lookDist < 0.04) {
              camera.position.copy(cameraTransition.targetPos);
              controls.target.copy(cameraTransition.targetLook);
              cameraTransition.active = false;
            } else {
              needsAnotherFrame = true;
            }
          }
        }

        const controlsChanged = controls.update();
        if (controlsChanged && controls.enableDamping) {
          needsAnotherFrame = true;
        }

        const t0 = performance.now();
        renderer.render(scene, camera);
        const frameMs = performance.now() - t0;

        if (now - lastPerfReportTs > 450) {
          lastPerfReportTs = now;
          callbacksRef.current.onPerfStats?.({
            isSoftwareGl,
            lastFrameMs: Math.round(frameMs * 10) / 10,
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          });
        }

        const done = () => {
          if (disposed) return;
          renderBusy = false;
          if (renderDirty || needsAnotherFrame) {
            requestRender();
          }
        };

        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    const handleControlsStart = () => {
      cameraTransition.active = false;
    };
    const handleControlsChange = () => {
      requestRender();
    };
    controls.addEventListener('start', handleControlsStart);
    controls.addEventListener('change', handleControlsChange);

    // Throttled pointermove raycasting (Layer 0 only -> ignores dimmed layer-2 upper bunks!)
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(0);
    let lastHoverTs = 0;
    let pointerDownX = 0;
    let pointerDownY = 0;

    const getHitFromEvent = (e: PointerEvent) => {
      const eng = engineRef.current;
      if (!eng) return null;
      const targets =
        stateRef.current.viewLevel === 'campus' &&
        stateRef.current.showFunctionalRooms &&
        eng.functionalHitTargets.length > 0
          ? [...eng.hitTargets, ...eng.functionalHitTargets]
          : eng.hitTargets;
      if (targets.length === 0) return null;

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects(targets, false);
      return hits.length > 0 ? hits[0].object : null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTs < 45) return;
      lastHoverTs = now;

      const eng = engineRef.current;
      if (!eng) return;

      const hit = getHitFromEvent(e);
      if (stateRef.current.viewLevel === 'campus') {
        const roomKey = hit?.userData?.type === 'room' ? String(hit.userData.roomKey) : null;
        const funcKey =
          hit?.userData?.type === 'functional' ? String(hit.userData.functionalKey) : null;

        if (roomKey !== eng.hoveredRoomKey) {
          eng.hoveredRoomKey = roomKey;
          applyCampusColorMode(
            eng.roomVisuals,
            stateRef.current.colorMode,
            roomKey,
            stateRef.current.focusedRoomKey,
            stateRef.current.unitXRayFilter,
            stateRef.current.sceneTheme
          );
          requestRender();
        }

        if (roomKey) {
          renderer.domElement.style.cursor = 'pointer';
          const handle = eng.roomVisuals.get(roomKey);
          if (handle) {
            callbacksRef.current.onHoverChange({
              type: 'room',
              screenX: e.clientX,
              screenY: e.clientY,
              room: handle.room,
            });
            return;
          }
        } else if (funcKey) {
          renderer.domElement.style.cursor = 'default';
          const funcNode = eng.functionalLookup.get(funcKey);
          if (funcNode) {
            callbacksRef.current.onHoverChange({
              type: 'functional',
              screenX: e.clientX,
              screenY: e.clientY,
              functional: funcNode,
            });
            return;
          }
        } else {
          renderer.domElement.style.cursor = 'grab';
        }
        callbacksRef.current.onHoverChange(null);
      } else {
        const bedId = hit?.userData?.type === 'bed' ? String(hit.userData.bedId) : null;
        if (bedId !== eng.hoveredBedId) {
          eng.hoveredBedId = bedId;
          applyBedHighlights(
            eng.bedVisuals,
            bedId,
            stateRef.current.selectedBedId,
            stateRef.current.bedTierFilter
          );
          requestRender();
        }
        renderer.domElement.style.cursor = bedId ? 'pointer' : 'grab';
        if (bedId) {
          const handle = eng.bedVisuals.get(bedId);
          if (handle) {
            callbacksRef.current.onHoverChange({
              type: 'bed',
              screenX: e.clientX,
              screenY: e.clientY,
              bed: handle.bed,
            });
            return;
          }
        }
        callbacksRef.current.onHoverChange(null);
      }
    };

    const handlePointerLeave = () => {
      const eng = engineRef.current;
      if (!eng) return;
      if (eng.hoveredRoomKey) {
        eng.hoveredRoomKey = null;
        applyCampusColorMode(
          eng.roomVisuals,
          stateRef.current.colorMode,
          null,
          stateRef.current.focusedRoomKey,
          stateRef.current.unitXRayFilter,
          stateRef.current.sceneTheme
        );
        requestRender();
      }
      if (eng.hoveredBedId) {
        eng.hoveredBedId = null;
        applyBedHighlights(
          eng.bedVisuals,
          null,
          stateRef.current.selectedBedId,
          stateRef.current.bedTierFilter
        );
        requestRender();
      }
      callbacksRef.current.onHoverChange(null);
    };

    const handlePointerUp = (e: PointerEvent) => {
      const moveDist = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
      if (moveDist > 6) return;

      const eng = engineRef.current;
      if (!eng) return;
      const hit = getHitFromEvent(e);

      if (stateRef.current.viewLevel === 'campus') {
        if (hit?.userData?.type === 'room') {
          const handle = eng.roomVisuals.get(String(hit.userData.roomKey));
          if (handle) {
            callbacksRef.current.onHoverChange(null);
            callbacksRef.current.onSelectRoom(handle.room);
          }
        }
      } else {
        if (hit?.userData?.type === 'bed') {
          const handle = eng.bedVisuals.get(String(hit.userData.bedId));
          if (handle) {
            callbacksRef.current.onSelectBed(handle.bed);
          }
        } else {
          callbacksRef.current.onSelectBed(null);
        }
      }
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', handlePointerDown);
    dom.addEventListener('pointermove', handlePointerMove);
    dom.addEventListener('pointerleave', handlePointerLeave);
    dom.addEventListener('pointerup', handlePointerUp);

    const resizeObserver = new ResizeObserver(entries => {
      if (disposed) return;
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(Math.floor(entry.contentRect.width), 300);
      const h = Math.max(Math.floor(entry.contentRect.height), 300);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    engineRef.current = {
      scene,
      camera,
      renderer,
      controls,
      hemiLight,
      keyLight,
      rimLight,
      contentRoot,
      roofsGroup: null,
      functionalGroup: null,
      isSoftwareGl,
      maxAnisotropy,
      hitTargets: [],
      functionalHitTargets: [],
      roomVisuals: new Map(),
      functionalLookup: new Map(),
      bedVisuals: new Map(),
      boundsCenter: new THREE.Vector3(0, 1, 0),
      boundsRadius: 20,
      hoveredRoomKey: null,
      hoveredBedId: null,
      lastCameraScopeKey: null,
      cameraTransition,
      requestRender,
    };

    requestRender();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', handleControlsStart);
      controls.removeEventListener('change', handleControlsChange);
      controls.dispose();
      dom.removeEventListener('pointerdown', handlePointerDown);
      dom.removeEventListener('pointermove', handlePointerMove);
      dom.removeEventListener('pointerleave', handlePointerLeave);
      dom.removeEventListener('pointerup', handlePointerUp);
      disposeObject3D(contentRoot);
      envTarget.dispose();
      renderer.dispose();
      if (dom.parentNode === container) {
        container.removeChild(dom);
      }
      engineRef.current = null;
    };
  }, []);

  // ── 2. Update Daylight vs Night Theme Lighting, Background & Fog ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    const bgHex = getThemeBgHex(sceneTheme);
    eng.scene.background = new THREE.Color(bgHex);
    if (eng.scene.fog instanceof THREE.FogExp2) {
      eng.scene.fog.color.setHex(bgHex);
    }

    if (sceneTheme === 'light') {
      eng.hemiLight.color.setHex(0xffffff);
      eng.hemiLight.groundColor.setHex(0x94a3b8);
      eng.hemiLight.intensity = 1.05;
      eng.keyLight.color.setHex(0xfffbeb);
      eng.keyLight.intensity = 1.75;
      eng.rimLight.color.setHex(0xbae6fd);
      eng.rimLight.intensity = 0.45;
      eng.renderer.toneMappingExposure = 1.08;
    } else {
      eng.hemiLight.color.setHex(0xcbd5e1);
      eng.hemiLight.groundColor.setHex(0x1e293b);
      eng.hemiLight.intensity = 0.78;
      eng.keyLight.color.setHex(0xfff5e4);
      eng.keyLight.intensity = 1.55;
      eng.rimLight.color.setHex(0x93c5fd);
      eng.rimLight.intensity = 0.55;
      eng.renderer.toneMappingExposure = 1.12;
    }

    eng.requestRender();
  }, [sceneTheme]);

  // ── 3. Rebuild 3D Scene Content (Camera resets ONLY when scope actually changes — zero snap-back!) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    while (eng.contentRoot.children.length > 0) {
      const child = eng.contentRoot.children[0];
      eng.contentRoot.remove(child);
      disposeObject3D(child);
    }
    eng.roofsGroup = null;
    eng.functionalGroup = null;
    eng.hitTargets = [];
    eng.functionalHitTargets = [];
    eng.roomVisuals = new Map();
    eng.functionalLookup = new Map();
    eng.bedVisuals = new Map();
    eng.hoveredRoomKey = null;
    eng.hoveredBedId = null;

    const bgHex = getThemeBgHex(sceneTheme);
    const nextScopeKey =
      viewLevel === 'campus' ? `campus::${campusScopeKey}` : `room::${activeRoom?.key || ''}`;
    const shouldResetCamera = eng.lastCameraScopeKey !== nextScopeKey;

    if (viewLevel === 'campus') {
      const built = buildCampusScene(
        ktxNodes,
        stateRef.current.colorMode,
        stateRef.current.unitXRayFilter,
        sceneTheme,
        eng.maxAnisotropy,
        !eng.isSoftwareGl,
        CAMPUS_BLUEPRINT_CONFIG
      );
      built.roofsGroup.visible = !stateRef.current.hideRoofs;
      built.functionalGroup.visible = stateRef.current.showFunctionalRooms;

      eng.contentRoot.add(built.group);
      eng.roofsGroup = built.roofsGroup;
      eng.functionalGroup = built.functionalGroup;
      eng.hitTargets = built.hitTargets;
      eng.functionalHitTargets = built.functionalHitTargets;
      eng.roomVisuals = built.roomVisuals;
      eng.functionalLookup = built.functionalLookup;
      eng.boundsCenter.copy(built.boundsCenter);
      eng.boundsRadius = built.boundsRadius;

      eng.scene.fog = new THREE.FogExp2(
        bgHex,
        Math.min(0.008, 0.26 / Math.max(25, built.boundsRadius))
      );
      const d = Math.min(95, Math.max(28, built.boundsRadius * 1.15));
      eng.keyLight.shadow.camera.left = -d;
      eng.keyLight.shadow.camera.right = d;
      eng.keyLight.shadow.camera.top = d;
      eng.keyLight.shadow.camera.bottom = -d;
      eng.keyLight.shadow.camera.updateProjectionMatrix();

      eng.controls.minDistance = 7;
      eng.controls.maxDistance = Math.max(120, built.boundsRadius * 3.4);

      applyCampusColorMode(
        eng.roomVisuals,
        stateRef.current.colorMode,
        null,
        stateRef.current.focusedRoomKey,
        stateRef.current.unitXRayFilter,
        sceneTheme
      );

      if (shouldResetCamera) {
        computeCameraForPreset(
          'campus',
          'overview',
          built.boundsCenter,
          built.boundsRadius,
          _desiredCamPos,
          _desiredTarget
        );
        eng.cameraTransition.targetPos.copy(_desiredCamPos);
        eng.cameraTransition.targetLook.copy(_desiredTarget);
        eng.cameraTransition.active = true;
      }
    } else if (activeRoom) {
      const built = buildRoomInteriorScene(
        activeRoom,
        activeRoomBeds,
        eng.maxAnisotropy,
        !eng.isSoftwareGl,
        showBedNames
      );
      eng.contentRoot.add(built.group);
      eng.hitTargets = built.hitTargets;
      eng.bedVisuals = built.bedVisuals;
      eng.boundsCenter.copy(built.boundsCenter);
      eng.boundsRadius = built.boundsRadius;

      eng.scene.fog = new THREE.FogExp2(bgHex, sceneTheme === 'light' ? 0.007 : 0.011);
      const d = Math.max(10, built.boundsRadius * 1.3);
      eng.keyLight.shadow.camera.left = -d;
      eng.keyLight.shadow.camera.right = d;
      eng.keyLight.shadow.camera.top = d;
      eng.keyLight.shadow.camera.bottom = -d;
      eng.keyLight.shadow.camera.updateProjectionMatrix();

      eng.controls.minDistance = 2.6;
      eng.controls.maxDistance = Math.max(24, built.boundsRadius * 3.2);

      applyBedHighlights(
        eng.bedVisuals,
        null,
        stateRef.current.selectedBedId,
        stateRef.current.bedTierFilter
      );

      if (shouldResetCamera) {
        computeCameraForPreset(
          'room',
          'overview',
          built.boundsCenter,
          built.boundsRadius,
          _desiredCamPos,
          _desiredTarget
        );
        eng.cameraTransition.targetPos.copy(_desiredCamPos);
        eng.cameraTransition.targetLook.copy(_desiredTarget);
        eng.cameraTransition.active = true;
      }
    }

    eng.lastCameraScopeKey = nextScopeKey;

    if (!eng.isSoftwareGl) {
      eng.renderer.compile(eng.scene, eng.camera);
    }
    eng.requestRender();
  }, [viewLevel, campusScopeKey, ktxNodes, activeRoom, activeRoomBeds, sceneTheme, showBedNames]);

  // ── 4. Instant 0ms Roof Cutaway & Functional Layer Toggles (zero geometry rebuild) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'campus' || !eng.roofsGroup) return;
    eng.roofsGroup.visible = !hideRoofs;
    eng.requestRender();
  }, [hideRoofs, viewLevel]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'campus' || !eng.functionalGroup) return;
    eng.functionalGroup.visible = showFunctionalRooms;
    eng.requestRender();
  }, [showFunctionalRooms, viewLevel]);

  // ── 5. Instant Color Mode / Unit X-Ray / Focused Room Re-styling (zero geometry rebuild) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'campus') return;
    applyCampusColorMode(
      eng.roomVisuals,
      colorMode,
      eng.hoveredRoomKey,
      focusedRoomKey,
      unitXRayFilter,
      sceneTheme
    );
    eng.requestRender();
  }, [colorMode, unitXRayFilter, focusedRoomKey, viewLevel, sceneTheme]);

  // ── 6. Instant Bed Selection & Bunk Tier Filter Highlight (with Layer-2 Click Pass-Through) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'room') return;
    applyBedHighlights(eng.bedVisuals, eng.hoveredBedId, selectedBedId, bedTierFilter);
    eng.requestRender();
  }, [selectedBedId, bedTierFilter, viewLevel]);

  // ── 7. Smooth Camera Preset Transitions ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !cameraPresetRequest) return;
    computeCameraForPreset(
      viewLevel,
      cameraPresetRequest.preset,
      eng.boundsCenter,
      eng.boundsRadius,
      _desiredCamPos,
      _desiredTarget
    );
    eng.cameraTransition.targetPos.copy(_desiredCamPos);
    eng.cameraTransition.targetLook.copy(_desiredTarget);
    eng.cameraTransition.active = true;
    eng.requestRender();
  }, [cameraPresetRequest, viewLevel]);

  // ── 8. Smooth Fly-To Specific Room on Campus (from Quick Search) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !focusRoomRequest || viewLevel !== 'campus') return;
    const handle = eng.roomVisuals.get(focusRoomRequest.roomKey);
    if (!handle) return;

    eng.cameraTransition.targetLook.copy(handle.worldCenter);
    eng.cameraTransition.targetPos.set(
      handle.worldCenter.x + 6.5,
      handle.worldCenter.y + 8.5,
      handle.worldCenter.z + 11.5
    );
    eng.cameraTransition.active = true;
    eng.requestRender();
  }, [focusRoomRequest, viewLevel]);

  // ── 9. Smooth Fly-To Specific Bunk Bed in Room Interior ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !focusBedRequest || viewLevel !== 'room') return;
    const handle = eng.bedVisuals.get(focusBedRequest.bedId);
    if (!handle) return;

    const sideSign = handle.worldCenter.x < 0 ? 1 : -1;
    eng.cameraTransition.targetLook.copy(handle.worldCenter);
    eng.cameraTransition.targetPos.set(
      handle.worldCenter.x + sideSign * 3.8,
      handle.worldCenter.y + 1.85,
      handle.worldCenter.z + 3.2
    );
    eng.cameraTransition.active = true;
    eng.requestRender();
  }, [focusBedRequest, viewLevel]);

  // ── 10. Smooth Zoom In / Out Buttons (for touchpad & mobile) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !zoomRequest) return;

    const baseTarget = eng.cameraTransition.active
      ? eng.cameraTransition.targetLook
      : eng.controls.target;
    const basePos = eng.cameraTransition.active
      ? eng.cameraTransition.targetPos
      : eng.camera.position;

    _offsetVec.copy(basePos).sub(baseTarget);
    const currentDist = _offsetVec.length();
    const nextDist = THREE.MathUtils.clamp(
      currentDist * zoomRequest.factor,
      eng.controls.minDistance,
      eng.controls.maxDistance
    );
    if (currentDist > 0.001) {
      _offsetVec.multiplyScalar(nextDist / currentDist);
    }

    eng.cameraTransition.targetLook.copy(baseTarget);
    eng.cameraTransition.targetPos.copy(baseTarget).add(_offsetVec);
    eng.cameraTransition.active = true;
    eng.requestRender();
  }, [zoomRequest]);

  if (webglUnsupported) {
    return (
      <div className="w-full h-full flex items-center justify-center p-6 bg-bg">
        <div className="max-w-md rounded-2xl bg-surf border border-bdr2 p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl tint-wn border border-wn/40 text-wn flex items-center justify-center mx-auto">
            <AlertTriangle size={24} />
          </div>
          <h3 className="text-base font-bold text-tx">Thiết bị không hỗ trợ WebGL 3D</h3>
          <p className="text-xs text-mu leading-relaxed">
            Trình duyệt hiện tại đang tắt tăng tốc đồ họa hoặc không hỗ trợ WebGL. Toàn bộ các trang quản lý 2D của hệ thống vẫn hoạt động bình thường.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      className="w-full h-full relative overflow-hidden select-none"
      aria-label="Khung hiển thị mô hình 3D Ký Túc Xá"
    />
  );
});

export default Ktx3DViewport;
