/*
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

#include "settings.h"
#include <pebble.h>
#include <pebble-events/pebble-events.h>

#include "../util/persist_keys.h"

static EventHandle s_event_handle;

static void prv_app_message_handler(DictionaryIterator *iter, void *context);

void settings_init() {
  s_event_handle = events_app_message_register_inbox_received(prv_app_message_handler, NULL);
}

void settings_deinit() {
  events_app_message_unsubscribe(s_event_handle);
}

QuickLaunchBehaviour settings_get_quick_launch_behaviour() {
  int result = persist_read_int(PERSIST_KEY_QUICK_LAUNCH_BEHAVIOUR);
  if (result == 0) {
    return QuickLaunchBehaviourConverseWithTimeout;
  }
  return result;
}

VibePatternSetting settings_get_alarm_vibe_pattern() {
  int result = persist_read_int(PERSIST_KEY_ALARM_VIBE_PATTERN);
  if (result == 0) {
    return VibePatternSettingStandard;
  }
  return result;
}

VibePatternSetting settings_get_timer_vibe_pattern() {
  int result = persist_read_int(PERSIST_KEY_TIMER_VIBE_PATTERN);
  if (result == 0) {
    return VibePatternSettingStandard;
  }
  return result;
}

bool settings_get_should_confirm_transcripts() {
  // the default is false, so we don't have to check whether it exists.
  return persist_read_bool(PERSIST_KEY_CONFIRM_TRANSCRIPTS);
}

QuickPromptsSetting settings_get_quick_prompts() {
  // English (0) is also the default when nothing has been stored yet.
  int result = persist_read_int(PERSIST_KEY_QUICK_PROMPTS);
  if (result < QuickPromptsEnglish || result > QuickPromptsCustom) {
    return QuickPromptsEnglish;
  }
  return result;
}

bool settings_get_custom_quick_prompts(char *buffer, size_t size) {
  if (size == 0 || !persist_exists(PERSIST_KEY_QUICK_PROMPTS_CUSTOM)) {
    return false;
  }
  persist_read_string(PERSIST_KEY_QUICK_PROMPTS_CUSTOM, buffer, size);
  buffer[size - 1] = '\0';
  return buffer[0] != '\0';
}

static QuickPromptsSetting prv_quick_prompts_from_code(const char *code) {
  if (strcmp(code, "de") == 0) {
    return QuickPromptsGerman;
  } else if (strcmp(code, "fr") == 0) {
    return QuickPromptsFrench;
  } else if (strcmp(code, "it") == 0) {
    return QuickPromptsItalian;
  } else if (strcmp(code, "custom") == 0) {
    return QuickPromptsCustom;
  }
  return QuickPromptsEnglish;
}

static void prv_store_custom_quick_prompts(const char *text) {
  if (text[0] == '\0') {
    persist_delete(PERSIST_KEY_QUICK_PROMPTS_CUSTOM);
    return;
  }
  char buffer[QUICK_PROMPTS_CUSTOM_MAX_LENGTH + 1];
  strncpy(buffer, text, sizeof(buffer));
  buffer[sizeof(buffer) - 1] = '\0';
  persist_write_string(PERSIST_KEY_QUICK_PROMPTS_CUSTOM, buffer);
}

static void prv_app_message_handler(DictionaryIterator *iter, void *context) {
  for (Tuple *tuple = dict_read_first(iter); tuple; tuple = dict_read_next(iter)) {
    if (tuple->key == MESSAGE_KEY_QUICK_LAUNCH_BEHAVIOUR) {
      int value = atoi(tuple->value->cstring);
      persist_write_int(PERSIST_KEY_QUICK_LAUNCH_BEHAVIOUR, value);
    } else if (tuple->key == MESSAGE_KEY_ALARM_VIBE_PATTERN) {
      persist_write_int(PERSIST_KEY_ALARM_VIBE_PATTERN, atoi(tuple->value->cstring));
    } else if (tuple->key == MESSAGE_KEY_TIMER_VIBE_PATTERN) {
      persist_write_int(PERSIST_KEY_TIMER_VIBE_PATTERN, atoi(tuple->value->cstring));
    } else if (tuple->key == MESSAGE_KEY_CONFIRM_TRANSCRIPTS) {
      persist_write_bool(PERSIST_KEY_CONFIRM_TRANSCRIPTS, tuple->value->int8);
    } else if (tuple->key == MESSAGE_KEY_QUICK_PROMPTS_LANG) {
      persist_write_int(PERSIST_KEY_QUICK_PROMPTS, prv_quick_prompts_from_code(tuple->value->cstring));
    } else if (tuple->key == MESSAGE_KEY_QUICK_PROMPTS_CUSTOM) {
      prv_store_custom_quick_prompts(tuple->value->cstring);
    }
  }
}
