import axios from 'axios';
import micromatch from 'micromatch';
import path from 'path';
import schedule from 'node-schedule';
import fs from 'fs';
import _sample from 'lodash.sample';
import { Console } from 'console';
import { setTimeout } from 'timers/promises';

import dayjs from 'dayjs';
import dayjs_utc from 'dayjs/plugin/utc.js';
import dayjs_timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(dayjs_utc);
dayjs.extend(dayjs_timezone);

const config = JSON.parse(fs.readFileSync("./config.json"));
if (!config || !config.PTERO_API_URL || !config.PTERO_API_KEY || !config.servers || !config.servers.length) {
  throw new Error('Error loading config, check config.json!');
}

const pteroAPI = axios.create({
  baseURL: config.PTERO_API_URL,
  headers: {
    'Authorization': `Bearer ${config.PTERO_API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'Application/vnd.pterodactyl.v1+json'
  }
});

let loggers = {};
const logRootDir = './logs';
const logPurgeCron = '0 0 * * *';
console.log(`starting log purge schedule - cron: '${logPurgeCron}' (${config.forceWipeTimezone})`);
schedule.scheduleJob(
  {
    rule: logPurgeCron,
    tz: config.forceWipeTimezone
  },
  () => {
    fs.readdirSync(logRootDir).forEach((entry) => {
      if (dayjs(entry).isBefore(dayjs().subtract(90, 'days'))) {
        console.log('removing logs older than 90 days', `(${path.resolve(logRootDir, entry)})`);
        fs.rmSync(path.resolve(logRootDir, entry), { recursive: true });
      }
    });
  }
);

console.log(`starting force wipe schedule - cron: '${config.forceWipeCron}' (${config.forceWipeTimezone})`);
schedule.scheduleJob(
  { 
    rule: config.forceWipeCron,
    tz: config.forceWipeTimezone
  },
  () => {
    let today = dayjs().tz(config.forceWipeTimezone);
    let firstThurs = getFirstThursday(today);
    
    if (!firstThurs.isSame(today, 'day')) return;

    let checks = 0;
    const checkOxide = setInterval(() => {
      axios.get('https://api.github.com/repos/OxideMod/Oxide.Rust/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github+json'
        },
        timeout: 60000
      })
        .then(res => {
          if (!res || !res.data || !res.data.published_at) return;

          let oxideReleaseDate = dayjs(res.data.published_at).tz(config.forceWipeTimezone);
          if (!oxideReleaseDate.isSame(today, 'day')) return;

          clearInterval(checkOxide);
          for (const wipeCfg of config.servers) {
            if (!wipeCfg.enabled)
              continue;

            let wipeSchedule = getWipeSchedule(wipeCfg);
            if (wipeSchedule.isTodayFirstThursday && wipeSchedule.schedule.length) {
              startWipe(wipeCfg, wipeSchedule, true);
            }
          }
        })
        .catch(err => {
          console.log(`error finding latest oxide version`, 'ERROR:', err & err.message ? err.message : '');
        });

        if (checks >= 120) {
          console.log(`failed to find latest oxide version after ${checks} tries`);
          clearInterval(checkOxide);
        }
        checks++;
    }, 60 * 2 * 1000);
  }
);

for (const wipeCfg of config.servers) {
  if (!wipeCfg.enabled)
    continue;

  getServer(wipeCfg.serverId)
    .then(data => {
      if (!data || !Object.keys(data).length) return;

      console.log(`starting schedule for ${data.attributes.name} (${wipeCfg.serverId}) - cron: '${wipeCfg.cron}' (${wipeCfg.timezone})`);
      schedule.scheduleJob(
        {
          rule: wipeCfg.cron,
          tz: wipeCfg.timezone
        },
        () => {
          let wipeSchedule = getWipeSchedule(wipeCfg);
          if (!wipeSchedule.isTodayFirstThursday && wipeSchedule.schedule.length) { // ignore if force wipe day
            startWipe(wipeCfg, wipeSchedule);
          }
        }
      );
    });
}

function getWipeSchedule(wipeCfg) {
  let today = dayjs().tz(wipeCfg.timezone);
  let firstThurs = getFirstThursday(today);

  if (today.isBefore(firstThurs, 'day'))
    firstThurs = getFirstThursday(today.subtract(7, 'days'));

  let daysSinceForce = today.diff(firstThurs, 'days');
  let schedule = wipeCfg.wipeSchedule.filter(x => x.daysSinceForceWipe == daysSinceForce);
  return {
    isBPWipe: schedule.length ? schedule[0].bpWipe : false,
    isTodayFirstThursday: firstThurs.isSame(today, 'day'),
    today: today,
    firstThurs: firstThurs,
    daysSinceForce: daysSinceForce,
    schedule: schedule
  };
}

function getFirstThursday(date) {
  let firstThurs = date.startOf('month');
  while (firstThurs.day() !== 4) { // thursday
    firstThurs = firstThurs.add(1, 'day');
  }
  return firstThurs;
}

function startWipe(wipeCfg, wipeSchedule, isForceWipe = false) {
  if (!wipeCfg.enabled)
    return;

  let logDir = path.join(logRootDir, wipeSchedule.today.format('YYYY-MM-DD'));
  return fs.promises.mkdir(logDir, { recursive: true })
    .then(() => {
      loggers[wipeCfg.serverId] = new Console({
        stdout: fs.createWriteStream(path.resolve(logDir, `${wipeCfg.serverId}-${wipeSchedule.today.format('hh-mm-a')}-log.txt`))
      });

      return getServer(wipeCfg.serverId);
    })
    .then(data => {
      if (!data || !Object.keys(data).length) {
        throw new Error(`unable to find server ${wipeCfg.serverId}`);
      }

      loggers[wipeCfg.serverId].log(`${data.attributes.name} (${wipeCfg.serverId})`);
      loggers[wipeCfg.serverId].log(`wipe started on ${wipeSchedule.today.format('ddd MMM D YYYY @ hh:mm a')} (${wipeCfg.timezone})`);
      loggers[wipeCfg.serverId].log('wipe schedule', wipeSchedule.schedule);
      loggers[wipeCfg.serverId].log(
        '\tisForceWipe:',
        isForceWipe,
        '\n\tisBPWipe:',
        wipeSchedule.isBPWipe,
        '\n\tisTodayFirstThursday:',
        wipeSchedule.isTodayFirstThursday,
        '\n\tfirstThurs:',
        wipeSchedule.firstThurs.format('ddd MMM D YYYY @ hh:mm a'),
        '\n\ttoday:',
        wipeSchedule.today.format('ddd MMM D YYYY @ hh:mm a'),
        '\n\tdaysSinceForce:',
        wipeSchedule.daysSinceForce
      );

      if (isForceWipe) {
        return sendMessage(wipeCfg.serverId, config.messages.forceWipe)
          .then(() => startCoundown(wipeCfg.serverId, wipeCfg.wipeCountdownSeconds));
      }

      return startCoundown(wipeCfg.serverId, wipeCfg.wipeCountdownSeconds);
    })
    .then(() => stopServer(wipeCfg.serverId))
    .then(() =>  deleteMatchedFiles(wipeCfg, isForceWipe, wipeSchedule.isBPWipe))
    .then(() => {
      loggers[wipeCfg.serverId].log('removing old seed and custom map url');
      return changeMapSeed(wipeCfg.serverId, "")
        .then(() => changeMapURL(wipeCfg.serverId, ""));
    })
    .then(() => {
      if (wipeCfg.maps && wipeCfg.maps.length) {
        loggers[wipeCfg.serverId].log('using custom map list');
        loggers[wipeCfg.serverId].log(wipeCfg.maps);
        return changeMapURL(wipeCfg.serverId, _sample(wipeCfg.maps));
      }

      let seed;
      if (wipeCfg.seeds && wipeCfg.seeds.length) {
        loggers[wipeCfg.serverId].log('using map seed list');
        loggers[wipeCfg.serverId].log(wipeCfg.seeds);
        seed = _sample(wipeCfg.seeds);
      }
      else {
        loggers[wipeCfg.serverId].log('generating random map seed');
        seed = Math.floor(Math.random() * 1000000) + 1000;
      }
      return changeMapSeed(wipeCfg.serverId, seed);
    })
    .then(() => startServer(wipeCfg.serverId))
    .then(() => {
      loggers[wipeCfg.serverId].log('wipe complete');
    })
    .catch(err => {
      loggers[wipeCfg.serverId].log(`error wiping server ${wipeCfg.serverId}`, 'ERROR:', err && err.message ? err.message : '');
    })
    .finally(() => {
      delete loggers[wipeCfg.serverId];
    });
}

function getServer(serverId) {
  return pteroAPI.get(`/servers/${serverId}`)
    .then(res => res.data || {})
    .catch(err => {
      let msg = [`error retreiving server details for ${serverId}`, 'ERROR:', err && err.message ? err.message : ''];
      if (loggers[serverId]) loggers[serverId].log(...msg);
      else console.log(...msg);
    });
}

function startCoundown(serverId, seconds) {
  seconds = !seconds || seconds < 30 ? 30 : seconds;
  let countdown = [30, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  let p = sendMessage(serverId, config.messages.wipeStart.replace('{0}', seconds / 60))
    .then(() => setTimeout((seconds - 30) * 1000));

  for (let i = 0; i < countdown.length; i++) {
    let s = countdown[i];
    let s2 = i == countdown.length-1 ? s : s - countdown[i+1];

    p = p.then(() => sendMessage(serverId, config.messages.wipeCountdown.replace('{0}', s)))
      .then(() => setTimeout(s2 * 1000));
  }

  return p;
}

function startServer(serverId) {
  return new Promise((resolve, reject) => {
    pteroAPI.post(`/servers/${serverId}/power`, { signal: 'start' })
      .then(() => {
        loggers[serverId].log(`starting server ${serverId}`);

        let retries = 1;
        const checkStatus = setInterval(() => {
          loggers[serverId].log(`checking server ${serverId} status (try #${retries})`);

          pteroAPI.get(`/servers/${serverId}/resources`)
            .then(res => {
              if (res.data.attributes.current_state == 'running') {
                loggers[serverId].log(`server ${serverId} online`);
                clearInterval(checkStatus);
                resolve();
              } else if (retries > 20) {
                clearInterval(checkStatus);
                reject(new Error(`server ${serverId} is NOT online! (retries: ${retries})`));
              }

              retries++;
            })
            .catch(err => {
              loggers[serverId].log(`error checking server ${serverId} status`, 'ERROR:', err && err.message ? err.message : '');
              clearInterval(checkStatus);
              reject(new Error(`error checking server ${serverId} status`));
            });
        }, 60000);
      })
      .catch(err => {
        loggers[serverId].log(`error starting server ${serverId}`, 'ERROR:', err && err.message ? err.message : '');
        reject();
      });
  });
}

function stopServer(serverId) {
  return new Promise((resolve, reject) => {
    pteroAPI.post(`/servers/${serverId}/power`, { signal: 'stop' })
      .then(() => {
        loggers[serverId].log(`stopping server ${serverId}`);

        let retries = 1;
        const checkStatus = setInterval(() => {
          loggers[serverId].log(`checking server ${serverId} status (try #${retries})`);

          pteroAPI.get(`/servers/${serverId}/resources`)
            .then(res => {
              if (res.data.attributes.current_state == 'offline') {
                loggers[serverId].log(`server ${serverId} offline`);
                clearInterval(checkStatus);
                resolve();
              } else if (retries > 10) {
                clearInterval(checkStatus);
                reject(new Error(`server ${serverId} is NOT offline! (retries: ${retries})`));
              }

              retries++;
            })
            .catch(err => {
              loggers[serverId].log(`error checking server ${serverId} status`, 'ERROR:', err && err.message ? err.message : '');
              clearInterval(checkStatus);
              reject(new Error(`error checking server ${serverId} status`));
            });
        }, 10000);
      })
      .catch(err => {
        loggers[serverId].log(`error stopping server ${serverId}`, 'ERROR:', err && err.message ? err.message : '');
        reject();
      });
  });
}

function findFiles(serverId, filesToMatch) {
  let matchedFiles = [];
  return pteroAPI.get(`/servers/${serverId}/files/list?directory=${filesToMatch.root}`)
    .then(res => {
      let files = [];
      for (const file of res.data.data) {
        files.push(file.attributes.name);
      }

      for (const glob of filesToMatch.files) {
        let matched = micromatch(files, glob);
        if (matched.length) {
          loggers[serverId].log(`match (root: ${filesToMatch.root}, glob: ${glob}):`, matched);

          for (const match of matched) {
            matchedFiles.push(path.posix.join(filesToMatch.root, match));
          }
        }
      }

      return matchedFiles;
    })
    .catch(err => {
      loggers[serverId].log(`error finding files for server ${serverId}`, 'ERROR:', err && err.message ? err.message : '');
    });
}

function deleteFiles(serverId, files) {
  return pteroAPI.post(`/servers/${serverId}/files/delete`, {
    root: '/',
    files: files
  })
    .then(() => {
      loggers[serverId].log(`successfully deleted ${files.length} files`);
    })
    .catch(err => {
      loggers[serverId].log(`error deleting files for server ${serverId}`, 'ERROR:', err && err.message ? err.message : '');
    });
}

function deleteMatchedFiles(wipeCfg, isForceWipe = false, isBPWipe = false) {
  let findFilesPromises = [];
  for (const fileList of wipeCfg.filesToDeleteOnWipe) {
    findFilesPromises.push(findFiles(wipeCfg.serverId, fileList));
  }

  if (isForceWipe) {
    for (const fileList of wipeCfg.filesToDeleteOnForceWipe) {
      findFilesPromises.push(findFiles(wipeCfg.serverId, fileList));
    }
  }

  if (isBPWipe) {
    let bpFiles = {
      root: '/server/rust',
      files: [
        'player.blueprints.*.db*'
      ]
    };
    findFilesPromises.push(findFiles(wipeCfg.serverId, bpFiles));

    for (const fileList of wipeCfg.filesToDeleteOnBPWipe) {
      findFilesPromises.push(findFiles(wipeCfg.serverId, fileList));
    }
  }

  return Promise.allSettled(findFilesPromises)
    .then(result => {
      let matchedFiles = result
        .filter(x => x.status === "fulfilled")
        .map(x => x.value)
        .flat();

      if (matchedFiles.length) {
        loggers[wipeCfg.serverId].log(`deleting ${matchedFiles.length} files`);
        loggers[wipeCfg.serverId].log(matchedFiles);
        return deleteFiles(wipeCfg.serverId, matchedFiles);
      }
    });
}

function updateServerVariable(serverId, varKey, varValue) {
  return pteroAPI.put(`/servers/${serverId}/startup/variable`, { key: varKey, value: `${varValue}` })
    .catch(err => {
      loggers[serverId].log(`error changing server variable (var: ${varKey}, value: ${varValue}) for server ${serverId}`, 'ERROR:', err && err.message ? err.message : '');
    });
}

function changeMapSeed(serverId, mapSeed) {
  loggers[serverId].log(`change server ${serverId} map seed ${mapSeed}`);
  return updateServerVariable(serverId, "WORLD_SEED", mapSeed);
}

function changeMapURL(serverId, mapURL) {
  loggers[serverId].log(`change server ${serverId} map url ${mapURL}`);
  return updateServerVariable(serverId, "MAP_URL", mapURL);
}

function sendMessage(serverId, msg) {
  loggers[serverId].log(`server ${serverId} SEND MESSAGE:`, msg);
  return pteroAPI.post(`/servers/${serverId}/command`, { command: `say ${msg}` })
    .catch(err => {
      loggers[serverId].log(`error sending message for server ${serverId}`, 'ERROR:', err && err.message ? err.message : '');
    });
}