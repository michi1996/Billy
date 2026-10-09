/*
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

#include "warmup.h"
#include "util/logging.h"

#include <pebble.h>
#include <pebble-events/pebble-events.h>

#define RETRY_MS 1000
#define MAX_ATTEMPTS 6

static int s_attempts;
static AppTimer *s_retry_timer;
static EventHandle s_sent_handle;
static EventHandle s_failed_handle;

static void prv_send(void *context);

static void prv_stop(void) {
  if (s_retry_timer) {
    app_timer_cancel(s_retry_timer);
    s_retry_timer = NULL;
  }
  if (s_sent_handle) {
    events_app_message_unsubscribe(s_sent_handle);
    s_sent_handle = NULL;
  }
  if (s_failed_handle) {
    events_app_message_unsubscribe(s_failed_handle);
    s_failed_handle = NULL;
  }
}

static void prv_retry(void) {
  if (s_retry_timer) {
    return;
  }
  if (++s_attempts >= MAX_ATTEMPTS) {
    BOBBY_LOG(APP_LOG_LEVEL_INFO, "Warm-up request not delivered; giving up.");
    prv_stop();
    return;
  }
  s_retry_timer = app_timer_register(RETRY_MS, prv_send, NULL);
}

static void prv_send(void *context) {
  s_retry_timer = NULL;
  DictionaryIterator *iter;
  // Busy usually means a question is on its way, which wakes the model anyway; try again later.
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    prv_retry();
    return;
  }
  dict_write_uint8(iter, MESSAGE_KEY_WARMUP, 1);
  if (app_message_outbox_send() != APP_MSG_OK) {
    prv_retry();
  }
}

static void prv_sent(DictionaryIterator *iter, void *context) {
  if (dict_find(iter, MESSAGE_KEY_WARMUP)) {
    BOBBY_LOG(APP_LOG_LEVEL_INFO, "Warm-up requested.");
    prv_stop();
  }
}

static void prv_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  if (dict_find(iter, MESSAGE_KEY_WARMUP)) {
    prv_retry();
  }
}

void warmup_request(void) {
  prv_stop();
  s_attempts = 0;
  s_sent_handle = events_app_message_register_outbox_sent(prv_sent, NULL);
  s_failed_handle = events_app_message_register_outbox_failed(prv_failed, NULL);
  prv_send(NULL);
}
