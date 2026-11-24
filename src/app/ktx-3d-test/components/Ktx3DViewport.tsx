'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AlertTriangle } from 'lucide-react';
import type {
  BedTierFilter,
  CameraNavMode,
  CameraPreset,
  CampusBuildingNode,
  CampusColorMode,
  CampusKtxNode,
  CampusRoomNode,
  FunctionalAreaNode,
  HoverInfo,
  RenderPerfStats,
  RoomBedSlot,
  RoomEquipmentCategory,
  SceneTheme,
  SiteLandmarkNode,
  UnitXRayFilter,
  ViewLevel,
} from '../types';
import {
  applyCampusColorMode,
  buildCampusScene,
  type BuildingVisualHandle,
  type InfrastructureVisualHandle,
  type RoomVisualHandle,
} from '../scene/campusBuilder';
import {
  applyBedHighlights,
  buildRoomInteriorScene,
  type BedVisualHandle,
} from '../scene/roomBuilder';
import type { CampusBlueprintConfig } from '../scene/campusLayoutConfig';
import { disposeObject3D } from '../scene/materials';

export interface Ktx3DViewportHandle {
  captureSnapshot: () => string | null;
  orbitStep: (deltaAzimuthDeg: number, deltaPolarDeg?: number) => void;
  resetNorth: () => void;
  getBuiltBuildingPositions: () => Record<
    string,
    { x: number; z: number; rotationDeg: number }
  >;
}

interface Ktx3DViewportProps {
  viewLevel: ViewLevel;
  sceneTheme: SceneTheme;
  campusScopeKey: string;
  navMode: CameraNavMode;
  blueprintConfig: CampusBlueprintConfig;
  ktxNodes: CampusKtxNode[];
  colorMode: CampusColorMode;
  unitXRayFilter: UnitXRayFilter | null;
  assignedOnlyFilter: boolean;
  focusedRoomKey: string | null;
  focusedBuildingKey: string | null;
  hiddenBuildingKeys: string[];
  hideRoofs: boolean;
  showRoofLabels?: boolean;
  showFunctionalRooms: boolean;
  showHiddenRooms: boolean;
  activeRoom: CampusRoomNode | null;
  activeRoomBeds: RoomBedSlot[];
  selectedBedId: string | null;
  bedTierFilter: BedTierFilter;
  showBedNames: boolean;
  cameraPresetRequest: { preset: CameraPreset; seq: number } | null;
  focusRoomRequest: { roomKey: string; seq: number } | null;
  focusBuildingRequest: { buildingKey: string; seq: number } | null;
  focusLandmarkRequest: { landmarkId: string; seq: number } | null;
  focusBedRequest: { bedId: string; seq: number } | null;
  zoomRequest: { factor: number; seq: number } | null;
  onSelectRoom: (room: CampusRoomNode) => void;
  onSelectBuilding?: (building: CampusBuildingNode) => void;
  onSelectLandmark?: (landmark: SiteLandmarkNode) => void;
  onSelectEquipment?: (equipmentType: RoomEquipmentCategory) => void;
  onLandmarksReady?: (landmarks: SiteLandmarkNode[]) => void;
  onSelectBed: (bed: RoomBedSlot | null) => void;
  onHoverChange: (info: HoverInfo | null) => void;
  onCompassHeadingChange?: (deg: number) => void;
  onPerfStats?: (stats: RenderPerfStats) => void;
}

// Pre-allocated scratch helpers (Zero GC inside render loop)
const _pointerNdc = new THREE.Vector2();
const _desiredCamPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _offsetVec = new THREE.Vector3();
const _spherical = new THREE.Spherical();
const _fwdVec = new THREE.Vector3();
const _rightVec = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _groundHit = new THREE.Vector3();

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
    navMode,
    blueprintConfig,
    ktxNodes,
    colorMode,
    unitXRayFilter,
    assignedOnlyFilter,
    focusedRoomKey,
    focusedBuildingKey,
    hiddenBuildingKeys,
    hideRoofs,
    showRoofLabels = true,
    showFunctionalRooms,
    showHiddenRooms,
    activeRoom,
    activeRoomBeds,
    selectedBedId,
    bedTierFilter,
    showBedNames,
    cameraPresetRequest,
    focusRoomRequest,
    focusBuildingRequest,
    focusLandmarkRequest,
    focusBedRequest,
    zoomRequest,
    onSelectRoom,
    onSelectBuilding,
    onSelectLandmark,
    onSelectEquipment,
    onLandmarksReady,
    onSelectBed,
    onHoverChange,
    onCompassHeadingChange,
    onPerfStats,
  },
  ref
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglUnsupported, setWebglUnsupported] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [restoreSeq, setRestoreSeq] = useState(0);

  const callbacksRef = useRef({
    onSelectRoom,
    onSelectBuilding,
    onSelectLandmark,
    onSelectEquipment,
    onLandmarksReady,
    onSelectBed,
    onHoverChange,
    onCompassHeadingChange,
    onPerfStats,
  });
  callbacksRef.current = {
    onSelectRoom,
    onSelectBuilding,
    onSelectLandmark,
    onSelectEquipment,
    onLandmarksReady,
    onSelectBed,
    onHoverChange,
    onCompassHeadingChange,
    onPerfStats,
  };

  const stateRef = useRef({
    viewLevel,
    sceneTheme,
    navMode,
    colorMode,
    unitXRayFilter,
    assignedOnlyFilter,
    focusedRoomKey,
    focusedBuildingKey,
    hideRoofs,
    showRoofLabels,
    showFunctionalRooms,
    showHiddenRooms,
    selectedBedId,
    bedTierFilter,
  });
  stateRef.current = {
    viewLevel,
    sceneTheme,
    navMode,
    colorMode,
    unitXRayFilter,
    assignedOnlyFilter,
    focusedRoomKey,
    focusedBuildingKey,
    hideRoofs,
    showRoofLabels,
    showFunctionalRooms,
    showHiddenRooms,
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
    roofLabelMeshes: THREE.Object3D[];
    isSoftwareGl: boolean;
    maxAnisotropy: number;
    hitTargets: THREE.Object3D[];
    functionalHitTargets: THREE.Object3D[];
    buildingHitTargets: THREE.Object3D[];
    infrastructureHitTargets: THREE.Object3D[];
    roomVisuals: Map<string, RoomVisualHandle>;
    functionalLookup: Map<string, FunctionalAreaNode>;
    buildingVisuals: Map<string, BuildingVisualHandle>;
    infrastructureVisuals: Map<string, InfrastructureVisualHandle>;
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

  // Expose synchronous Snapshot, smooth 360° orbit/tilt steering, North align & current building positions
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
      orbitStep: (deltaAzimuthDeg: number, deltaPolarDeg = 0) => {
        const eng = engineRef.current;
        if (!eng) return;
        const baseTarget = eng.cameraTransition.active
          ? eng.cameraTransition.targetLook
          : eng.controls.target;
        const basePos = eng.cameraTransition.active
          ? eng.cameraTransition.targetPos
          : eng.camera.position;

        _offsetVec.copy(basePos).sub(baseTarget);
        _spherical.setFromVector3(_offsetVec);
        _spherical.theta += THREE.MathUtils.degToRad(deltaAzimuthDeg);
        _spherical.phi = THREE.MathUtils.clamp(
          _spherical.phi + THREE.MathUtils.degToRad(deltaPolarDeg),
          eng.controls.minPolarAngle + 0.02,
          eng.controls.maxPolarAngle - 0.01
        );
        _offsetVec.setFromSpherical(_spherical);

        eng.cameraTransition.targetLook.copy(baseTarget);
        eng.cameraTransition.targetPos.copy(baseTarget).add(_offsetVec);
        eng.cameraTransition.active = true;
        eng.requestRender();
      },
      resetNorth: () => {
        const eng = engineRef.current;
        if (!eng) return;
        const baseTarget = eng.cameraTransition.active
          ? eng.cameraTransition.targetLook
          : eng.controls.target;
        const basePos = eng.cameraTransition.active
          ? eng.cameraTransition.targetPos
          : eng.camera.position;

        _offsetVec.copy(basePos).sub(baseTarget);
        _spherical.setFromVector3(_offsetVec);
        _spherical.theta = 0;
        _offsetVec.setFromSpherical(_spherical);

        eng.cameraTransition.targetLook.copy(baseTarget);
        eng.cameraTransition.targetPos.copy(baseTarget).add(_offsetVec);
        eng.cameraTransition.active = true;
        eng.requestRender();
      },
      getBuiltBuildingPositions: () => {
        const eng = engineRef.current;
        const result: Record<string, { x: number; z: number; rotationDeg: number }> = {};
        if (!eng) return result;
        eng.buildingVisuals.forEach((handle, key) => {
          result[key] = {
            x: handle.builtX,
            z: handle.builtZ,
            rotationDeg: handle.builtRotationDeg,
          };
        });
        return result;
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
    scene.fog = new THREE.FogExp2(initBg, 0.0034);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.15, 580);
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
    renderer.domElement.style.touchAction = 'none';
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
    keyLight.position.set(48, 72, 42);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = isSoftwareGl ? 1024 : 2048;
    keyLight.shadow.mapSize.height = isSoftwareGl ? 1024 : 2048;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 260;
    keyLight.shadow.camera.left = -68;
    keyLight.shadow.camera.right = 68;
    keyLight.shadow.camera.top = 68;
    keyLight.shadow.camera.bottom = -68;
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
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI / 2 - 0.015;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minDistance = 3.2;
    controls.maxDistance = 210;
    // Pan parallel to campus ground plane + zoom straight toward mouse pointer!
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    controls.rotateSpeed = 1.0;
    controls.panSpeed = 1.2;
    controls.zoomSpeed = 1.2;

    const cameraTransition = {
      active: false,
      targetPos: new THREE.Vector3(),
      targetLook: new THREE.Vector3(),
    };

    const heldKeys = new Set<string>();
    const NAV_KEYS = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyQ',
      'KeyE',
      'KeyR',
      'KeyF',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]);

    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;
    let lastTickTs = performance.now();
    let lastPerfReportTs = 0;
    let lastCompassReportTs = 0;
    let lastCompassDeg = -999;

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

        // Smooth free-roam keyboard movement (WASD / Arrows pan on ground plane, Q/E rotate 360°, R/F tilt)
        if (heldKeys.size > 0) {
          cameraTransition.active = false;
          _offsetVec.copy(camera.position).sub(controls.target);
          const dist = Math.max(5, _offsetVec.length());
          const moveSpeed = Math.max(8, dist * 0.65) * delta;

          camera.getWorldDirection(_fwdVec);
          _fwdVec.y = 0;
          if (_fwdVec.lengthSq() > 0.0001) {
            _fwdVec.normalize();
          } else {
            _fwdVec.set(0, 0, -1);
          }
          _rightVec.crossVectors(_fwdVec, _upVec).normalize();

          const forwardInput =
            (heldKeys.has('KeyW') || heldKeys.has('ArrowUp') ? 1 : 0) -
            (heldKeys.has('KeyS') || heldKeys.has('ArrowDown') ? 1 : 0);
          const strafeInput =
            (heldKeys.has('KeyD') || heldKeys.has('ArrowRight') ? 1 : 0) -
            (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft') ? 1 : 0);

          if (forwardInput !== 0) {
            camera.position.addScaledVector(_fwdVec, forwardInput * moveSpeed);
            controls.target.addScaledVector(_fwdVec, forwardInput * moveSpeed);
          }
          if (strafeInput !== 0) {
            camera.position.addScaledVector(_rightVec, strafeInput * moveSpeed);
            controls.target.addScaledVector(_rightVec, strafeInput * moveSpeed);
          }

          const yawInput = (heldKeys.has('KeyE') ? 1 : 0) - (heldKeys.has('KeyQ') ? 1 : 0);
          const pitchInput = (heldKeys.has('KeyF') ? 1 : 0) - (heldKeys.has('KeyR') ? 1 : 0);
          if (yawInput !== 0 || pitchInput !== 0) {
            _offsetVec.copy(camera.position).sub(controls.target);
            _spherical.setFromVector3(_offsetVec);
            _spherical.theta += yawInput * 1.15 * delta;
            _spherical.phi = THREE.MathUtils.clamp(
              _spherical.phi + pitchInput * 0.85 * delta,
              controls.minPolarAngle + 0.02,
              controls.maxPolarAngle - 0.01
            );
            _offsetVec.setFromSpherical(_spherical);
            camera.position.copy(controls.target).add(_offsetVec);
          }
          needsAnotherFrame = true;
        }

        const controlsChanged = controls.update();
        if (controlsChanged && controls.enableDamping) {
          needsAnotherFrame = true;
        }

        const t0 = performance.now();
        renderer.render(scene, camera);
        const frameMs = performance.now() - t0;

        if (now - lastCompassReportTs > 110) {
          lastCompassReportTs = now;
          const azDeg = Math.round(THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()));
          const normDeg = ((azDeg % 360) + 360) % 360;
          if (normDeg !== lastCompassDeg) {
            lastCompassDeg = normDeg;
            callbacksRef.current.onCompassHeadingChange?.(normDeg);
          }
        }

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
      const targets: THREE.Object3D[] =
        stateRef.current.viewLevel === 'campus'
          ? [
              ...eng.hitTargets,
              ...eng.buildingHitTargets,
              ...eng.infrastructureHitTargets,
              ...(stateRef.current.showFunctionalRooms ? eng.functionalHitTargets : []),
            ]
          : eng.hitTargets;
      if (targets.length === 0) return null;

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects(targets, false);
      for (let i = 0; i < hits.length; i++) {
        let cur: THREE.Object3D | null = hits[i].object;
        let visibleInChain = true;
        while (cur) {
          if (!cur.visible) {
            visibleInChain = false;
            break;
          }
          cur = cur.parent;
        }
        if (visibleInChain) return hits[i].object;
      }
      return null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    };

    const handlePointerMove = (e: PointerEvent) => {
      // Skip raycasting & hover tooltips while actively rotating/panning the camera (zero stutter!)
      if (e.buttons !== 0) {
        renderer.domElement.style.cursor = 'grabbing';
        callbacksRef.current.onHoverChange(null);
        return;
      }

      const now = performance.now();
      if (now - lastHoverTs < 45) return;
      lastHoverTs = now;

      const eng = engineRef.current;
      if (!eng) return;

      const hit = getHitFromEvent(e);
      if (stateRef.current.viewLevel === 'campus') {
        const roomKey = hit?.userData?.type === 'room' ? String(hit.userData.roomKey) : null;
        const bldKey =
          hit?.userData?.type === 'building' ? String(hit.userData.buildingKey) : null;
        const landmarkId =
          hit?.userData?.type === 'landmark' ? String(hit.userData.landmarkId) : null;
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
            stateRef.current.sceneTheme,
            stateRef.current.assignedOnlyFilter,
            stateRef.current.focusedBuildingKey
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
        } else if (bldKey) {
          renderer.domElement.style.cursor = 'pointer';
          const bHandle = eng.buildingVisuals.get(bldKey);
          if (bHandle) {
            callbacksRef.current.onHoverChange({
              type: 'building',
              screenX: e.clientX,
              screenY: e.clientY,
              building: bHandle.building,
            });
            return;
          }
        } else if (landmarkId) {
          renderer.domElement.style.cursor = 'pointer';
          const lHandle = eng.infrastructureVisuals.get(landmarkId);
          if (lHandle) {
            callbacksRef.current.onHoverChange({
              type: 'landmark',
              screenX: e.clientX,
              screenY: e.clientY,
              landmark: lHandle.landmark,
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
        const equipmentType =
          hit?.userData?.type === 'equipment'
            ? (hit.userData.equipmentType as RoomEquipmentCategory)
            : null;
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
        renderer.domElement.style.cursor = bedId || equipmentType ? 'pointer' : 'grab';
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
        } else if (equipmentType && hit) {
          callbacksRef.current.onHoverChange({
            type: 'equipment',
            screenX: e.clientX,
            screenY: e.clientY,
            equipment: {
              equipmentType,
              label: String(hit.userData.label || 'Thiết bị phòng'),
              count: Number(hit.userData.count || 0),
              roomLabel: String(hit.userData.roomLabel || ''),
            },
          });
          return;
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
          stateRef.current.sceneTheme,
          stateRef.current.assignedOnlyFilter,
          stateRef.current.focusedBuildingKey
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
        } else if (hit?.userData?.type === 'building') {
          const bHandle = eng.buildingVisuals.get(String(hit.userData.buildingKey));
          if (bHandle) {
            const dist = Math.max(12, bHandle.radius * 1.42);
            eng.cameraTransition.targetLook.copy(bHandle.worldCenter);
            eng.cameraTransition.targetPos.set(
              bHandle.worldCenter.x + dist * 0.48,
              bHandle.worldCenter.y + dist * 0.62,
              bHandle.worldCenter.z + dist * 0.85
            );
            eng.cameraTransition.active = true;
            requestRender();
            callbacksRef.current.onSelectBuilding?.(bHandle.building);
          }
        } else if (hit?.userData?.type === 'landmark') {
          const lHandle = eng.infrastructureVisuals.get(String(hit.userData.landmarkId));
          if (lHandle) {
            eng.cameraTransition.targetLook.copy(lHandle.worldCenter);
            eng.cameraTransition.targetPos.copy(lHandle.worldCenter).add(lHandle.cameraOffset);
            eng.cameraTransition.active = true;
            requestRender();
            callbacksRef.current.onHoverChange(null);
            callbacksRef.current.onSelectLandmark?.(lHandle.landmark);
          }
        }
      } else {
        if (hit?.userData?.type === 'bed') {
          const handle = eng.bedVisuals.get(String(hit.userData.bedId));
          if (handle) {
            callbacksRef.current.onSelectBed(handle.bed);
          }
        } else if (hit?.userData?.type === 'equipment') {
          callbacksRef.current.onSelectEquipment?.(
            hit.userData.equipmentType as RoomEquipmentCategory
          );
        } else {
          callbacksRef.current.onSelectBed(null);
        }
      }
    };

    // Double-click ground plane in Campus view to smoothly recenter free 360° orbit pivot on that spot
    const handleDoubleClick = (e: MouseEvent) => {
      const eng = engineRef.current;
      if (!eng || stateRef.current.viewLevel !== 'campus') return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointerNdc, camera);
      if (raycaster.ray.intersectPlane(_groundPlane, _groundHit)) {
        _offsetVec.copy(camera.position).sub(controls.target);
        eng.cameraTransition.targetLook.set(_groundHit.x, 1.2, _groundHit.z);
        eng.cameraTransition.targetPos.copy(eng.cameraTransition.targetLook).add(_offsetVec);
        eng.cameraTransition.active = true;
        requestRender();
      }
    };

    const handleNavKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (NAV_KEYS.has(e.code)) {
        if (e.code.startsWith('Arrow')) e.preventDefault();
        const wasEmpty = heldKeys.size === 0;
        heldKeys.add(e.code);
        if (wasEmpty) {
          lastTickTs = performance.now();
          requestRender();
        }
      }
    };

    const handleNavKeyUp = (e: KeyboardEvent) => {
      heldKeys.delete(e.code);
    };

    const handleWindowBlur = () => {
      heldKeys.clear();
    };

    // Resilient WebGL Context Loss & Auto-Restore (for long-running 24/7 monitoring & laptop sleep)
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
      setRestoreSeq(prev => prev + 1);
      requestRender();
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', handlePointerDown);
    dom.addEventListener('pointermove', handlePointerMove);
    dom.addEventListener('pointerleave', handlePointerLeave);
    dom.addEventListener('pointerup', handlePointerUp);
    dom.addEventListener('dblclick', handleDoubleClick);
    dom.addEventListener('webglcontextlost', handleContextLost, false);
    dom.addEventListener('webglcontextrestored', handleContextRestored, false);
    window.addEventListener('keydown', handleNavKeyDown);
    window.addEventListener('keyup', handleNavKeyUp);
    window.addEventListener('blur', handleWindowBlur);

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
      roofLabelMeshes: [],
      isSoftwareGl,
      maxAnisotropy,
      hitTargets: [],
      functionalHitTargets: [],
      buildingHitTargets: [],
      infrastructureHitTargets: [],
      roomVisuals: new Map(),
      functionalLookup: new Map(),
      buildingVisuals: new Map(),
      infrastructureVisuals: new Map(),
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
      dom.removeEventListener('dblclick', handleDoubleClick);
      dom.removeEventListener('webglcontextlost', handleContextLost);
      dom.removeEventListener('webglcontextrestored', handleContextRestored);
      window.removeEventListener('keydown', handleNavKeyDown);
      window.removeEventListener('keyup', handleNavKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      disposeObject3D(contentRoot);
      envTarget.dispose();
      renderer.dispose();
      if (dom.parentNode === container) {
        container.removeChild(dom);
      }
      engineRef.current = null;
    };
  }, []);

  // ── 1b. Switch Mouse Navigation Mode (Free 360° Orbit vs Hand Pan) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (navMode === 'pan') {
      eng.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    } else {
      eng.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    }
  }, [navMode]);

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
    eng.roofLabelMeshes = [];
    eng.hitTargets = [];
    eng.functionalHitTargets = [];
    eng.buildingHitTargets = [];
    eng.infrastructureHitTargets = [];
    eng.roomVisuals = new Map();
    eng.functionalLookup = new Map();
    eng.buildingVisuals = new Map();
    eng.infrastructureVisuals = new Map();
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
        blueprintConfig,
        stateRef.current.assignedOnlyFilter,
        showFunctionalRooms,
        showHiddenRooms,
        hiddenBuildingKeys.length > 0 ? new Set(hiddenBuildingKeys) : undefined
      );
      built.roofsGroup.visible = !stateRef.current.hideRoofs;
      built.functionalGroup.visible = showFunctionalRooms;
      built.roofLabelMeshes.forEach(m => {
        m.visible = stateRef.current.showRoofLabels;
      });

      eng.contentRoot.add(built.group);
      eng.roofsGroup = built.roofsGroup;
      eng.functionalGroup = built.functionalGroup;
      eng.roofLabelMeshes = built.roofLabelMeshes;
      eng.hitTargets = built.hitTargets;
      eng.functionalHitTargets = built.functionalHitTargets;
      eng.buildingHitTargets = built.buildingHitTargets;
      eng.infrastructureHitTargets = built.infrastructureHitTargets;
      eng.roomVisuals = built.roomVisuals;
      eng.functionalLookup = built.functionalLookup;
      eng.buildingVisuals = built.buildingVisuals;
      eng.infrastructureVisuals = built.infrastructureVisuals;
      eng.boundsCenter.copy(built.boundsCenter);
      eng.boundsRadius = built.boundsRadius;

      callbacksRef.current.onLandmarksReady?.(
        Array.from(built.infrastructureVisuals.values()).map(v => v.landmark)
      );

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
        sceneTheme,
        stateRef.current.assignedOnlyFilter,
        stateRef.current.focusedBuildingKey
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
  }, [
    viewLevel,
    campusScopeKey,
    blueprintConfig,
    ktxNodes,
    activeRoom,
    activeRoomBeds,
    sceneTheme,
    showBedNames,
    showFunctionalRooms,
    showHiddenRooms,
    hiddenBuildingKeys,
    restoreSeq,
  ]);

  // ── 4. Instant 0ms Roof Cutaway & Functional Layer Toggles (zero geometry rebuild) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'campus' || !eng.roofsGroup) return;
    eng.roofsGroup.visible = !hideRoofs;
    eng.requestRender();
  }, [hideRoofs, viewLevel]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'campus') return;
    eng.roofLabelMeshes.forEach(m => {
      m.visible = showRoofLabels;
    });
    eng.requestRender();
  }, [showRoofLabels, viewLevel]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'campus' || !eng.functionalGroup) return;
    eng.functionalGroup.visible = showFunctionalRooms;
    eng.requestRender();
  }, [showFunctionalRooms, viewLevel]);

  // ── 5. Instant Color Mode / Unit X-Ray / Assigned Blocks / Focused Room & Row Re-styling ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || viewLevel !== 'campus') return;
    applyCampusColorMode(
      eng.roomVisuals,
      colorMode,
      eng.hoveredRoomKey,
      focusedRoomKey,
      unitXRayFilter,
      sceneTheme,
      assignedOnlyFilter,
      focusedBuildingKey
    );
    eng.requestRender();
  }, [
    colorMode,
    unitXRayFilter,
    assignedOnlyFilter,
    focusedRoomKey,
    focusedBuildingKey,
    viewLevel,
    sceneTheme,
  ]);

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

  // ── 8. Smooth Fly-To Specific Room on Campus (from Quick Search or Alert Bar) ──
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

  // ── 8b. Smooth Focus & Zoom onto Specific Dormitory Row (Dãy) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !focusBuildingRequest || viewLevel !== 'campus') return;
    const bHandle = eng.buildingVisuals.get(focusBuildingRequest.buildingKey);
    if (!bHandle) return;

    const dist = Math.max(11.5, bHandle.radius * 1.18);
    eng.cameraTransition.targetLook.copy(bHandle.worldCenter);
    eng.cameraTransition.targetPos.set(
      bHandle.worldCenter.x + dist * 0.16,
      bHandle.worldCenter.y + dist * 0.52,
      bHandle.worldCenter.z + dist * 0.88
    );
    eng.cameraTransition.active = true;
    eng.requestRender();
  }, [focusBuildingRequest, viewLevel]);

  // ── 8c. Smooth Fly-To Specific Vincons Site Infrastructure Landmark ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !focusLandmarkRequest || viewLevel !== 'campus') return;
    const lHandle = eng.infrastructureVisuals.get(focusLandmarkRequest.landmarkId);
    if (!lHandle) return;

    eng.cameraTransition.targetLook.copy(lHandle.worldCenter);
    eng.cameraTransition.targetPos.copy(lHandle.worldCenter).add(lHandle.cameraOffset);
    eng.cameraTransition.active = true;
    eng.requestRender();
  }, [focusLandmarkRequest, viewLevel]);

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
    >
      {contextLost && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0b1220]/90 p-6">
          <div className="max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 text-center space-y-2 text-slate-100">
            <AlertTriangle size={22} className="text-amber-400 mx-auto" />
            <p className="text-sm font-bold">Đang phục hồi kết nối đồ họa 3D...</p>
            <p className="text-xs text-slate-400">
              Trình duyệt vừa tạm thu hồi GPU. Mô hình sẽ tự hiển thị lại ngay sau vài giây.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

export default Ktx3DViewport;
