/* global THREE */

global.THREE = require('three')
const TWEEN = require('@tweenjs/tween.js')
require('three/examples/js/controls/OrbitControls')

const { Viewer, Entity } = require('../viewer')

const io = require('socket.io-client')
const socket = io({
  path: window.location.pathname + 'socket.io'
})

let firstPositionUpdate = true

const renderer = new THREE.WebGLRenderer()
renderer.setPixelRatio(window.devicePixelRatio || 1)
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const viewer = new Viewer(renderer)

let controls = new THREE.OrbitControls(viewer.camera, renderer.domElement)

function animate () {
  window.requestAnimationFrame(animate)
  if (controls) controls.update()
  viewer.update()
  renderer.render(viewer.scene, viewer.camera)
}
animate()

window.addEventListener('resize', () => {
  viewer.camera.aspect = window.innerWidth / window.innerHeight
  viewer.camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

socket.on('version', (version) => {
  if (!viewer.setVersion(version)) {
    return false
  }

  firstPositionUpdate = true
  viewer.listen(socket)

  let botMesh
  let lastFollowUpdate = 0
  let followTweens = []
  socket.on('position', ({ pos, addMesh, yaw, pitch, follow }) => {
    if (yaw !== undefined && pitch !== undefined) {
      if (controls) {
        controls.dispose()
        controls = null
      }
      viewer.setFirstPersonCamera(pos, yaw, pitch)
      return
    }
    if (pos.y > 0 && firstPositionUpdate) {
      controls.target.set(pos.x, pos.y, pos.z)
      viewer.camera.position.set(pos.x, pos.y + 20, pos.z + 20)
      controls.update()
      firstPositionUpdate = false
    } else if (follow && controls) {
      // Keep orbiting the view as it moves: target and camera shift together, so whatever angle
      // and distance the viewer has chosen are kept. Each glide lasts as long as the gap since
      // the last update, so a camera moved every half second glides rather than steps.
      const now = performance.now()
      const duration = Math.min(Math.max(now - lastFollowUpdate, 50), 1000)
      lastFollowUpdate = now
      const dx = pos.x - controls.target.x
      const dy = pos.y - controls.target.y
      const dz = pos.z - controls.target.z
      for (const tween of followTweens) tween.stop()
      followTweens = [
        new TWEEN.Tween(controls.target).to({ x: pos.x, y: pos.y, z: pos.z }, duration).start(),
        new TWEEN.Tween(viewer.camera.position).to({ x: viewer.camera.position.x + dx, y: viewer.camera.position.y + dy, z: viewer.camera.position.z + dz }, duration).start()
      ]
    }
    if (botMesh) botMesh.visible = !!addMesh
    if (addMesh) {
      if (!botMesh) {
        botMesh = new Entity('1.16.4', 'player', viewer.scene).mesh
        viewer.scene.add(botMesh)
      }
      new TWEEN.Tween(botMesh.position).to({ x: pos.x, y: pos.y, z: pos.z }, 50).start()

      const da = (yaw - botMesh.rotation.y) % (Math.PI * 2)
      const dy = 2 * da % (Math.PI * 2) - da
      new TWEEN.Tween(botMesh.rotation).to({ y: botMesh.rotation.y + dy }, 50).start()
    }
  })
})
