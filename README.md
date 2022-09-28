# Pterodactyl Rust Auto Wipe
Scheduling tool built with nodejs to automatically wipe Rust servers hosted on the Pterodactyl panel.

## Features
* Wipe scheduling system using cron jobs
* Wipe multiple servers with different wipe schedules
* Force wipe support (watches for rust updates on first thursday of the month)
* Delete files with glob file matching
* Automatically change map seed or custom map url from predefined list
* Generate random map seed
* Detailed wipe logs
* Logs older than 90 days are automatically deleted
* Docker support

# Pterodactyl Client API

Before starting the auto wipe system you will need to generate a Pterodactyl client API key (https://pterodactyl.panel/account/api) and retrieve the server ids for the rust servers you would like to wipe. 

Server ids can be found in the url when viewing the server in the panel (https://pterodactyl.panel/server/SERVER_ID).

# Configuration

### Wipe Schedule

The wipe schedule uses a cron job and is based on the number of days since the first Thursday of the month (force wipe day). To build a wipe schedule count the number of days since the first Thursday of the month for each day you would like to wipe.

![Calendar](https://i.imgur.com/L3MlYgU.png)

Using the calendar above as an example, the following wipe schedule will wipe weekly every Thursday @ 2PM.

```json
{
  "cron": "0 14 * * *",
  "timezone": "America/New_York",
  "wipeSchedule": [
    {
      "daysSinceForceWipe": 0,
      "bpWipe": true
    },
    {
      "daysSinceForceWipe": 7,
      "bpWipe": false
    },
    {
      "daysSinceForceWipe": 14,
      "bpWipe": false
    },
    {
      "daysSinceForceWipe": 21,
      "bpWipe": false
    },
    {
      "daysSinceForceWipe": 28,
      "bpWipe": false
    }
  ]
}
```

### Force Wipe

Rust updates are usually released around 2PM EST on the first Thursday of each month. The script creates a timer to watch for the latest Oxide mod update (umod.org) starting at 1PM EST on the first Thursday of the month and checks for an update every 2 minutes.

In the servers wipe schedule, 0 days since force wipe is considered force wipe day.
```json
{
  "daysSinceForceWipe": 0,
  "bpWipe": true
}
```

### Deleting files

Delete files with glob file matching starting from the root directory `/home/container`

```json
{
  "root": "/server/rust",
  "files": [
    "player.deaths.*.db*",
    "player.identities.*.db*",
    "player.states.*.db*",
    "player.tokens.db*",
    "sv.files.*.db*",
    "*.map",
    "*.sav*"
  ]
}
```

Files can be deleted based on the type of wipe by using the following server config options.

* `filesToDeleteOnForceWipe` - Files to delete on force wipe day
* `filesToDeleteOnBPWipe` - Files to delete on BP wipe day
* `filesToDeleteOnWipe` - Files to delete on every wipe day

Note: Blueprint files are automatically deleted on BP wipe days, you do not need to specify blueprint files within `filesToDeleteOnBPWipe`. The list is intended for any other files you would like to delete on BP wipe days.

### Server Messages

Messages are broadcast to the server when a wipe is starting or when a new force wipe update has been released. A countdown will start based on `wipeCountdownSeconds` (default 5 minutes) and will countdown the last 30 seconds before the server restarts for wipe.

### Map Seed / Custom Map URL

Randomly generated map seeds, predefined map seeds and custom map urls are supported.

* Make sure that `server.seed` and `server.levelurl` are removed from your `/rust/server/cfg/server.cfg`!
* Add the map size (`server.worldsize`) to your `server.cfg` or as a startup variable.
* Map seeds will be ignored if a custom map list is defined.
* Map seeds and map urls are randomly chosen from list.
* Map seeds are randomly generated if both `seeds` and `maps` lists are empty.

#### Custom Map List
```json
{
  "seeds": [],
  "maps": [
    "https://link.to/my/custom/rust_map_1.map",
    "https://link.to/my/custom/rust_map_2.map",
    "https://link.to/my/custom/rust_map_3.map"
  ]
}
```

#### Predefined Seed List
```json
{
  "seeds": [
    1234,
    4567,
    8910
  ],
  "maps": []
}
```

### Example Configuration
```json
{
  "PTERO_API_URL": "https://pterodactyl.panel/api/client",
  "PTERO_API_KEY": "",
  "forceWipeCron": "0 13 * * 4",
  "forceWipeTimezone": "America/New_York",
  "messages": {
    "wipeStart": "[Auto Wipe] Server restarting for wipe in {0} minutes!",
    "wipeCountdown": "[Auto Wipe] Server restarting for wipe in {0}s!",
    "forceWipe": "[Auto Wipe] A new Rust update has been released! Please close Rust to download the update and rejoin when the server has wiped."
  },
  "servers": [
    {
      "_comment": "Weekly wipes every Thursday @ 2PM, monthly BP wipes",
      "enabled": true,
      "serverId": "0",
      "cron": "0 14 * * *",
      "timezone": "America/New_York",
      "wipeCountdownSeconds": 300,
      "seeds": [],
      "maps": [],
      "wipeSchedule": [
        {
          "daysSinceForceWipe": 0,
          "bpWipe": true
        },
        {
          "daysSinceForceWipe": 7,
          "bpWipe": false
        },
        {
          "daysSinceForceWipe": 14,
          "bpWipe": false
        },
        {
          "daysSinceForceWipe": 21,
          "bpWipe": false
        },
        {
          "daysSinceForceWipe": 28,
          "bpWipe": false
        }
      ],
      "filesToDeleteOnForceWipe": [],
      "filesToDeleteOnBPWipe": [],
      "filesToDeleteOnWipe": [
        {
          "root": "/server/rust",
          "files": [
            "player.deaths.*.db*",
            "player.identities.*.db*",
            "player.states.*.db*",
            "player.tokens.db*",
            "sv.files.*.db*",
            "*.map",
            "*.sav*"
          ]
        },
        {
          "root": "/oxide/data/ServerRewards",
          "files": [
            "player_data.json"
          ]
        }
      ]
    }
  ]
}
```

# Docker

* Clone git repo to a new directory
* Build `config.json` based on `config-example.json`
* Pull latest image or build docker image from repo
* Create docker container with image

### Pull Latest Docker Image
```console
docker pull ghcr.io/clearshot-xs/pterodactyl-rust-auto-wipe:latest

docker run -d \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/logs:/app/logs \
  --name pterodactyl-rust-auto-wipe \
  ghcr.io/clearshot-xs/pterodactyl-rust-auto-wipe:latest
```

### Build Docker Image
```console
docker build . -t pterodactyl-rust-auto-wipe:latest

docker run -d \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/logs:/app/logs \
  --name pterodactyl-rust-auto-wipe \
  pterodactyl-rust-auto-wipe:latest
```

# Without Docker

* Install NodeJS (v16.17.0 or higher) and NPM
* Clone git repo to a new directory
* Build `config.json` based on `config-example.json`
* Run `npm install`
* Launch script with `node index.js` or using a service manager such as systemd or PM2
