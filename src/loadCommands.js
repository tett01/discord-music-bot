const fs = require('node:fs');
const path = require('node:path');

function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commands = new Map();

  for (const file of fs.readdirSync(commandsPath)) {
    if (!file.endsWith('.js')) continue;
    const command = require(path.join(commandsPath, file));
    if (!command?.data?.name || typeof command.execute !== 'function') continue;
    commands.set(command.data.name, command);
  }

  return commands;
}

module.exports = { loadCommands };
