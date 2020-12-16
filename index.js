'use strict';

// ~~ Req ~~
const net = require('net');
const crypto = require('crypto');
const os = require('os');

// ~~ Constants ~~

/** Signature of action set */
const ACT_SIGN_OPEN = 'ACT[';
const ACT_SIGN_CLOSE = ']';
const ACT_SEP = ',';
/** Action codes */
const ACT_CLOSE = 'CLOSE';
const ACT_SEND = 'SEND';
const ACT_DATA = 'DATA';
const ACT_WAIT = 'WAIT';
const ACT_SHUT = 'SHUT';

const ACTION_DESCR = {
  [ACT_CLOSE]: ' - close connection',
  [ACT_DATA]: '=length - write <length> of random data',
  [ACT_SEND]: '=resp - write <resp> string (URL-encoding is supported)',
  [ACT_WAIT]: '=time - wait for <time> msecs',
  [ACT_SHUT]: ' - stop the server from listening (won\'t close active connections)'
};

const DEF_PORT = 11111;

const USAGE = [
  'TCP server for testing purposes. Behavior is controlled by global parameter or request text.',
  'Usage:',
  'node <scriptname.js> [port] [actionset]',
  `  port - port number to listen (default is ${DEF_PORT})`,
  '  actionset - global set or actions for all clients (see below)',
  'Request must contain action set:',
  ` "${ACT_SIGN_OPEN}"<set>"${ACT_SIGN_CLOSE}"`,
  `   <set> ::= "" | <action>[=<param>][${ACT_SEP}<action>[=<param>]]...`,
  '   After executing all actions connection is left active.',
  '   If <set> is empty, server just does nothing with the connection',
  '   <action>:',
  ...Object.keys(ACTION_DESCR).map((item) => `    - ${item}${ACTION_DESCR[item]}`)
].join(os.EOL);

// ~~ Utils ~~

/**
  Create promise for calling a method that takes callback on successful completion
  and emits 'error' on failure.
    @param {NodeJS.EventEmitter} emitter - object
    @param {Function} method - method to call
    @param {...any} args - arguments to call method with

    @returns {Promise}
 */
function promisifyCbAndError(emitter, method, ...args)
{
  return new Promise(
    (resolve, reject) =>
    {
      // We must cleanup listeners when they're not needed more
      /** @private */
      function onError(err) { reject(err); }
      method.call(emitter, ...args, () => { emitter.off('error', onError); resolve(); });
      emitter.once('error', onError);
    });
}

/**
  Close and wait for it
    @param {net.Socket} socket - socket
 */
async function act_close(socket)
{
  await promisifyCbAndError(socket, socket.end);
}

/**
  Send string and wait for it
    @param {net.Socket} socket - socket
    @param {String} data - data
 */
async function act_send(socket, data)
{
  await promisifyCbAndError(socket, socket.write, data ? unescape(data) : data);
}

/**
  Send random data and wait for it
    @param {net.Socket} socket - socket
    @param {String} length - data length
 */
async function act_data(socket, length)
{
  await promisifyCbAndError(socket, socket.write, crypto.randomBytes(Number(length)));
}

/**
  Sleep for some time
    @param {net.Socket} socket - socket
    @param {String} time - msecs to wait
 */
async function act_wait(socket, time)
{
  await new Promise((resolve) => { setTimeout(resolve, Number(time)); });
}

/**
  Shutdown the server
    @param {net.Socket} socket - socket
 */
async function act_shut(socket)
{
  await new Promise((resolve) => { socket.server.close(resolve); });
}

const METHOD_MAP = {
  [ACT_CLOSE]: act_close,
  [ACT_DATA]: act_data,
  [ACT_SEND]: act_send,
  [ACT_WAIT]: act_wait,
  [ACT_SHUT]: act_shut
};

/**
  Log to console with timestamp
    @param {...any} args - arguments
 */
function log(...args)
{
  console.log((new Date()).toISOString(), ...args);
}

/**
  Parse string with actions
    @param {String} request - string
    @returns {Array<{cmd: String, param: String}>} array of actions with params. Empty array could be returned as well
 */
function parseRequest(request)
{
  if (!request || !request.includes(ACT_SIGN_OPEN) || !request.includes(ACT_SIGN_CLOSE))
    return undefined;
  const actStr = request.slice(request.indexOf(ACT_SIGN_OPEN) + ACT_SIGN_OPEN.length, request.indexOf(ACT_SIGN_CLOSE));
  if (actStr == '')
    return [];
  const result = [];
  const actions = actStr.split(ACT_SEP);
  for (const item of actions)
    result.push({cmd: item.split('=')[0], param: item.split('=')[1]});
  return result;
}

/**
  Execute actions over a socket listed in actions object
    @param {net.Socket} socket - socket
    @param {Array<{cmd: String, param: String}>} actions - list of actions and parameters
 */
async function execActions(socket, actions)
{
  // Empty actions - just do nothing
  if (actions.length == 0)
  {
    log('No actions defined - do nothing');
    return;
  }
  for (const item of actions)
  {
    if (!METHOD_MAP[item.cmd])
    {
      log('ERROR - Unknown action', item.cmd);
      socket.end();
      return;
    }
    log(`Executing action ${item.cmd}${item.param ? ': ' + item.param.trim() : ''}`);
    await METHOD_MAP[item.cmd](socket, item.param);
  }
}

// ~~ Main ~~

const SCRIPT_ARGS_START_IDX = 2;
const args = process.argv.slice(SCRIPT_ARGS_START_IDX); // get our personal arguments only

// 1st argument is "?" - print usage
if (args.length == 1 && ['/?', '-?', '?'].indexOf(args[0]) != -1)
{
  console.log(USAGE);
  return;
}

let portNum = DEF_PORT;
let globActions = undefined; // global actions
while (args.length > 0)
{
  if (!isNaN(Number(args[0])))
    portNum = Number(args[0]);
  else
  {
    globActions = parseRequest(args[0]);
    if (!globActions)
    {
      console.log('Action list is incorrect', args[0]);
      return;
    }
  }
  args.shift();
}

const srv = net.createServer();
srv.on('connection',
  (socket) =>
  {
    log('Socket connected');
    // this field is not in official API so ensuring it's assigned
    if (!socket.server)
      socket.server = srv;
    if (globActions)
      execActions(socket, globActions);
    else
      socket.on('data',
        (data) =>
        {
          const reqStr = data.toString();
          log('Socket IN:', reqStr);
          if (socket.dataGot) return;
          socket.dataGot = true;

          const actions = parseRequest(reqStr);
          if (!actions)
          {
            log('Request incorrect');
            socket.end();
            return;
          }

          execActions(socket, actions);
        });
    socket.on('close', ()=>log('Socket Closed'));
    socket.on('error', (err)=>log('Socket Error', err));
  }
);
srv.listen(portNum, ()=>log('Server listening at port', srv.address().port));