/**
 * Copyright 2026 Achi
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The one tool set Benny exposes. It is the same, in the same order, on every request so that
// llama-server can reuse its prompt cache.

var clock = require('./clock');
var uiTools = require('./ui_tools');
var weatherTool = require('./weather_tool');
var watchTools = require('./watch_tools');
var validation = require('./validation');

exports.getDeclarations = function() {
    return uiTools.getDeclarations()
        .concat(weatherTool.getDeclarations())
        .concat(watchTools.getDeclarations());
};

// `call` is a parsed tool call from llm_client: {id, name, arguments, argumentsError}.
// The callback receives the result object that goes back to the model.
exports.execute = function(session, call, callback) {
    if (call.argumentsError) {
        callback({status: 'error', error: 'Invalid arguments for ' + call.name + ': ' + call.argumentsError + '. Call the tool again with a JSON object.'});
        return;
    }
    var args = call.arguments || {};
    if (call.name === 'ask_clarifying_question') {
        uiTools.execute(session, args, callback);
        return;
    }
    if (call.name === 'get_weather') {
        weatherTool.execute(session, args, callback);
        return;
    }
    if (!validation.hasValidator(call.name)) {
        callback({status: 'error', error: 'Unknown tool ' + call.name + '.'});
        return;
    }
    var checked = validation.validate(call.name, args, clock.now());
    if (!checked.ok) {
        console.log('Rejected ' + call.name + ' arguments: ' + checked.error);
        callback({status: 'error', error: checked.error});
        return;
    }
    watchTools.execute(session, call.name, checked.args, callback);
};
