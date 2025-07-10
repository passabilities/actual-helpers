const schedule = require('node-schedule')

const trackCrypto = require('./track-crypto')
const { openBudget, closeBudget } = require('./utils')

let running = false

const run = async () => {
  if (running) return
  running = true

  await trackCrypto()

  running = false
}

openBudget().then(async () => {
  await run()

  // run every 15 minutes
  schedule.scheduleJob('*/15 * * * *', () => {
    run()
  })
})

async function exitHandler(options, exitCode) {
  await closeBudget();

  if (options.cleanup) console.log('clean');
  if (exitCode || exitCode === 0) console.log(exitCode);
  if (options.exit) process.exit();
}

// do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
