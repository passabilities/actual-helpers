const schedule = require('node-schedule')

const trackCrypto = require('./track-crypto')
const syncBitcoin = require('./sync-bitcoin')

const cp = require('child_process')

let running = false

const run = async () => {
  if (running) return
  running = true

  await trackCrypto()
  await syncBitcoin()

  running = false
}

run()

//cp.fork('track-crypto.js')
//cp.fork('sync-bitcoin.js')
//cp.fork('track-investments.js')
//
// run at 8am & 8pm
//schedule.scheduleJob('0 8,20 * * *', () => {
//  cp.fork('track-investments.js')
//})

// run every 15 minutes
schedule.scheduleJob('*/15 * * * *', () => {
  run()
})
