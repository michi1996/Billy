/**
 * Copyright 2025 Google LLC
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

// The timeline public URL root
var API_URL_ROOT = 'https://timeline-api.rebble.io/';
// How long one pin request may take, waiting for the timeline token included.
var REQUEST_TIMEOUT_MS = 20000;

// Calls back exactly once: with null when the timeline service accepted the request, otherwise
// with a short description of what went wrong. Deleting a pin the service does not know counts
// as done.
function timelineRequest(pin, type, topics, apiKey, callback) {
    // User or shared?
    var url = API_URL_ROOT + 'v1/' + ((topics != null) ? 'shared/' : 'user/') + 'pins/' + pin.id;
    var xhr = null;
    var finished = false;
    var timer = setTimeout(function() {
        if (xhr) {
            xhr.abort();
        }
        finish('no answer from the timeline service');
    }, REQUEST_TIMEOUT_MS);

    function finish(error) {
        if (finished) {
            return;
        }
        finished = true;
        clearTimeout(timer);
        if (error) {
            console.log('timeline: ' + type + ' failed: ' + error);
        }
        if (callback) {
            callback(error || null);
        }
    }

    function send(token) {
        if (finished) {
            return;
        }
        // Create XHR
        xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var accepted = (this.status >= 200 && this.status < 300) || (type === 'DELETE' && this.status === 404);
            console.log('timeline: ' + type + ' answered with HTTP ' + this.status + '.');
            if (!accepted && this.responseText) {
                console.log('timeline: response: ' + String(this.responseText).substring(0, 200));
            }
            finish(accepted ? null : 'HTTP ' + this.status);
        };
        xhr.onerror = function () {
            finish('timeline service unreachable');
        };
        xhr.open(type, url);

        // Set headers
        xhr.setRequestHeader('Content-Type', 'application/json');
        if(topics != null) {
            xhr.setRequestHeader('X-Pin-Topics', '' + topics.join(','));
            xhr.setRequestHeader('X-API-Key', '' + apiKey);
        }
        xhr.setRequestHeader('X-User-Token', '' + token);

        // Send
        xhr.send(JSON.stringify(pin));
        console.log('timeline: request sent.');
    }

    // Get token
    try {
        Pebble.getTimelineToken(function(token) {
            try {
                send(token);
            } catch (e) {
                finish('request failed: ' + e.message);
            }
        }, function(error) {
            console.log('timeline: error getting timeline token: ' + error);
            finish('no timeline token');
        });
    } catch (e) {
        finish('no timeline token');
    }
}

// Insert a pin into the timeline
exports.insertUserPin = function(pin, callback) {
    timelineRequest(pin, 'PUT', null, null, callback);
};

// Delete a pin from the timeline
exports.deleteUserPin = function(pinId, callback) {
    var pin = { "id": pinId };
    timelineRequest(pin, 'DELETE', null, null, callback);
};
