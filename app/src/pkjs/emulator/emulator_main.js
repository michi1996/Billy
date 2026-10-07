var location = require("../location");
var reminders = require("../reminders");
var emulatorSession = require("./emulator_session");
var session = require("../session");
var config = require("../config");

function main() {
    location.update();
    Pebble.addEventListener('appmessage', handleAppMessage);
}


function handleAppMessage(e) {
    console.log("Inbound app message!");
    console.log(JSON.stringify(e));
    var data = e.payload;
    if (data.PROMPT) {
        // The "Emulator: use the real server" setting sends prompts to the configured server,
        // using the values stored by the config page (pebble emu-app-config). Otherwise the
        // emulator replays recorded answers.
        var s;
        if (config.isEmulatorRealServerEnabled()) {
            console.log("Starting a real Session against the configured server...");
            s = new session.Session(data.PROMPT, data.THREAD_ID);
        } else {
            console.log("Starting a prerecorded Session...");
            s = new emulatorSession.Session(data.PROMPT, data.THREAD_ID);
        }
        s.run();
        return;
    }

    if (reminders.handleReminderMessage(data)) {
        return;
    }

    if ('LOCATION_ENABLED' in data) {
        config.setSetting("LOCATION_ENABLED", !!data.LOCATION_ENABLED);
        console.log("Location enabled: " + config.isLocationEnabled());
        // We need to confirm that we received this for the watch to proceed.
        Pebble.sendAppMessage({
            LOCATION_ENABLED: data.LOCATION_ENABLED,
        });
    }
}

exports.main = main;
