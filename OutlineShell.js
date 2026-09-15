// OutlineShell.js
//
// Outline real por "casca invertida" (inverted hull): clona a geometria do
// objeto, infla os vértices ao longo da normal por uma espessura configurável
// e renderiza apenas as faces de trás (BackSide) com cor sólida, sem luz.
// Isso desenha um contorno de silhueta real, independente e por trás do
// objeto original — não é EdgesGeometry (linhas nas arestas), é geometria
// 3D de verdade que acompanha a forma do objeto.
//
// A casca é adicionada como filho do mesh, então herda automaticamente a
// posição/rotação/escala do objeto (inclusive quando movido via
// TransformControls) sem nenhum código extra de sincronização.

import * as THREE from 'three';

const _shellVertex = /* glsl */`
  uniform float uThickness;
  void main() {
    vec3 inflated = position + normal * uThickness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(inflated, 1.0);
  }
`;

const _shellFragment = /* glsl */`
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

function makeShellMaterial(color, thickness) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) }
    },
    vertexShader: _shellVertex,
    fragmentShader: _shellFragment,
    side: THREE.BackSide,
    depthWrite: true,
    depthTest: true
  });
}

/**
 * Cria (ou atualiza) a casca de contorno de um mesh.
 * @param {THREE.Mesh} mesh
 * @param {{color:string, width:number}} params
 * @returns {THREE.Mesh} a casca (também guardada em mesh.userData._ncmOutlineShell)
 */
export function ensureOutlineShell(mesh, params) {
  if (!mesh || !mesh.geometry) return null;

  let shell = mesh.userData._ncmOutlineShell;
  if (!shell) {
    shell = new THREE.Mesh(mesh.geometry, makeShellMaterial(params.color, params.width));
    shell.name = '__ncmOutlineShell';
    shell.userData.isHelper = true;      // nunca selecionável / nunca afetado por outros efeitos
    shell.userData.isNcmShell = true;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.renderOrder = (mesh.renderOrder || 0) - 1;
    mesh.add(shell);
    mesh.userData._ncmOutlineShell = shell;
  } else if (shell.geometry !== mesh.geometry) {
    shell.geometry = mesh.geometry; // geometria pode ter mudado (ex: undo/redo)
  }

  shell.material.uniforms.uThickness.value = params.width;
  shell.material.uniforms.uColor.value.set(params.color);
  shell.visible = true;
  return shell;
}

export function removeOutlineShell(mesh) {
  const shell = mesh?.userData?._ncmOutlineShell;
  if (!shell) return;
  mesh.remove(shell);
  shell.material.dispose();
  delete mesh.userData._ncmOutlineShell;
}
