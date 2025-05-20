const schedule = require('node-schedule')

const cp = require('child_process')

// run every 6 hours
const job = schedule.scheduleJob('0 8,20 * * *', () => {
  cp.fork('sync-banks.js')
  cp.fork('track-investments.js')
})
