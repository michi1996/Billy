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

var timeline = require('../actions/timeline');

// Store reminders in localStorage
var REMINDERS_STORAGE_KEY = 'billy_reminders';
// Keep expired reminders for 24 hours before cleanup
var EXPIRED_REMINDER_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function loadReminders() {
  var stored = localStorage.getItem(REMINDERS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveReminders(reminders) {
  localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
}

function cleanupExpiredReminders() {
  var reminders = loadReminders();
  var now = new Date();
  var cutoffTime = now.getTime() - EXPIRED_REMINDER_TTL;
  
  // Filter out reminders that are older than the cutoff time
  var activeReminders = reminders.filter(function(reminder) {
    var reminderTime = new Date(reminder.time).getTime();
    return reminderTime > cutoffTime;
  });
  
  // If we removed any reminders, save the updated list
  if (activeReminders.length < reminders.length) {
    console.log("Cleaned up " + (reminders.length - activeReminders.length) + " expired reminders");
    saveReminders(activeReminders);
  }
  
  return activeReminders;
}

// Calls back with (null, id) once the timeline service has the pin, or with an error message.
// Only reminders that reached the timeline are kept here.
function addReminder(text, time, callback) {
  // Clean up expired reminders first
  cleanupExpiredReminders();
  
  var date = (new Date(time)).toISOString();
  console.log("Setting a reminder: \"" + text + "\" at " + date);
  var reminderId = "billy-reminder-" + Math.random();
  
  var pin = {
    "id": reminderId,
    "time": date,
    "layout": {
      "type": "genericPin",
      "title": text,
      "tinyIcon": "system://images/NOTIFICATION_REMINDER"
    },
    "reminders": [{
      "time": date,
      "layout": {
        "type": "genericReminder",
        "title": text,
        "tinyIcon": "system://images/NOTIFICATION_REMINDER"
      }
    }]
  };

  // Insert into timeline first
  timeline.insertUserPin(pin, function(error) {
    if (error) {
      callback(error);
      return;
    }

    // Store reminder locally
    var reminders = loadReminders();
    reminders.push({
      id: reminderId,
      time: date,
      what: text
    });
    saveReminders(reminders);
    callback(null, reminderId);
  });
}

// Calls back with (null, true) once the pin is gone, (null, false) for an unknown id, or with an
// error message; a reminder whose pin could not be deleted stays in the list.
function deleteReminder(id, callback) {
  // Clean up expired reminders first
  cleanupExpiredReminders();
  
  var known = loadReminders().some(function(reminder) {
    return reminder.id === id;
  });
  
  if (!known) {
    callback(null, false);
    return;
  }
  
  // Remove from timeline first
  timeline.deleteUserPin(id, function(error) {
    if (error) {
      callback(error);
      return;
    }

    // Remove from local storage
    saveReminders(loadReminders().filter(function(reminder) {
      return reminder.id !== id;
    }));
    callback(null, true);
  });
}

function getAllReminders() {
  // Clean up expired reminders before returning the list
  var reminders = cleanupExpiredReminders();
  
  // Sort reminders by time
  reminders.sort(function(a, b) {
    return new Date(a.time) - new Date(b.time);
  });
  
  // Only return future reminders
  var now = new Date();
  return reminders.filter(function(r) {
    return new Date(r.time) > now;
  });
}

module.exports = {
  addReminder: addReminder,
  deleteReminder: deleteReminder,
  getAllReminders: getAllReminders
}; 