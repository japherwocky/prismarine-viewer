const EventEmitter = require('events')
const { WorldView } = require('../viewer')

module.exports = (bot, { viewDistance = 6, firstPerson = false, port = 3000, prefix = '', followCamera = false, follow = false }) => {
  const express = require('express')

  const app = express()
  const http = require('http').createServer(app)

  const io = require('socket.io')(http, { path: prefix + '/socket.io' })

  const { setupRoutes } = require('./common')
  setupRoutes(app, prefix)

  // Proxies player skins and capes for the browser (textures.minecraft.net
  // sends no CORS headers). Only that host, by texture hash, so it can't be
  // used as an open proxy.
  app.get(prefix + '/texture/:hash([0-9a-f]+)', async (req, res) => {
    try {
      const texture = await fetch(`https://textures.minecraft.net/texture/${req.params.hash}`)
      if (!texture.ok) return res.sendStatus(texture.status === 404 ? 404 : 502)
      res.type('png').send(Buffer.from(await texture.arrayBuffer()))
    } catch (err) {
      res.sendStatus(502)
    }
  })

  const sockets = []
  const primitives = {}

  // With followCamera, the view is whatever the bot's camera is on: a spectator bot told to
  // spectate an entity (/spectate) gets a camera packet naming it, and its own position stops
  // updating while the server moves it along with that entity. Otherwise the view is the bot.
  let cameraId = null
  bot._client.on('camera', ({ cameraId: id }) => { cameraId = id })
  function viewpoint () {
    const target = followCamera && cameraId !== null && cameraId !== bot.entity.id ? bot.entities[cameraId] : undefined
    return target ?? bot.entity
  }

  bot.viewer = new EventEmitter()

  bot.viewer.erase = (id) => {
    delete primitives[id]
    for (const socket of sockets) {
      socket.emit('primitive', { id })
    }
  }

  bot.viewer.drawBoxGrid = (id, start, end, color = 'aqua') => {
    primitives[id] = { type: 'boxgrid', id, start, end, color }
    for (const socket of sockets) {
      socket.emit('primitive', primitives[id])
    }
  }

  bot.viewer.drawLine = (id, points, color = 0xff0000) => {
    primitives[id] = { type: 'line', id, points, color }
    for (const socket of sockets) {
      socket.emit('primitive', primitives[id])
    }
  }

  bot.viewer.drawPoints = (id, points, color = 0xff0000, size = 5) => {
    primitives[id] = { type: 'points', id, points, color, size }
    for (const socket of sockets) {
      socket.emit('primitive', primitives[id])
    }
  }

  io.on('connection', (socket) => {
    socket.emit('version', bot.version)
    sockets.push(socket)

    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, socket)
    worldView.init(bot.entity.position)

    worldView.on('blockClicked', (block, face, button) => {
      bot.viewer.emit('blockClicked', block, face, button)
    })

    for (const id in primitives) {
      socket.emit('primitive', primitives[id])
    }

    function botPosition () {
      const view = viewpoint()
      // The bot is drawn when the view is its own, unless it is a spectator, which nobody sees
      const addMesh = view === bot.entity && bot.game?.gameMode !== 'spectator'
      const packet = { pos: view.position, yaw: view.headYaw ?? view.yaw, addMesh, follow }
      if (firstPerson) {
        packet.pitch = view.pitch
      }
      socket.emit('position', packet)
      worldView.updatePosition(view.position)
    }
    function cameraMoved (entity) {
      if (entity === viewpoint() && entity !== bot.entity) botPosition()
    }

    bot.on('move', botPosition)
    bot.on('entityMoved', cameraMoved)
    bot._client.on('camera', botPosition)
    worldView.listenToBot(bot)
    socket.on('disconnect', () => {
      bot.removeListener('move', botPosition)
      bot.removeListener('entityMoved', cameraMoved)
      bot._client.removeListener('camera', botPosition)
      worldView.removeListenersFromBot(bot)
      sockets.splice(sockets.indexOf(socket), 1)
    })
  })

  http.listen(port, () => {
    console.log(`Prismarine viewer web server running on *:${port}`)
  })

  bot.viewer.close = () => {
    http.close()
    for (const socket of sockets) {
      socket.disconnect()
    }
  }
}
