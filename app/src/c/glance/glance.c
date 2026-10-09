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

#include "glance.h"
#include "glance_text.h"
#include "../alarms/manager.h"
#include "../util/logging.h"
#include "../util/time.h"

#include <pebble.h>

#if !defined(PBL_PLATFORM_APLITE)

#define MAX_ENTRIES 8

// "6:45 AM" today, "Tue, 6:45 AM" within a week, "Oct 15, 6:45 AM" after that.
static void prv_format_alarm_time(char *out, size_t size, time_t when) {
  struct tm when_tm = *localtime(&when);
  char time_text[16];
  format_time_ampm(time_text, sizeof(time_text), &when_tm);
  time_t midnight = time_start_of_today();
  if (when < midnight + SECONDS_PER_DAY) {
    snprintf(out, size, "%s", time_text);
    return;
  }
  char day_text[12];
  strftime(day_text, sizeof(day_text), when < midnight + 7 * SECONDS_PER_DAY ? "%a" : "%b %d", &when_tm);
  snprintf(out, size, "%s, %s", day_text, time_text);
}

static void prv_reload(AppGlanceReloadSession *session, size_t limit, void *context) {
  // Slices are shown in the order they are added, each until it expires: soonest first.
  Alarm *entries[MAX_ENTRIES];
  int count = 0;
  time_t now = time(NULL);
  int total = alarm_manager_get_alarm_count();
  for (int i = 0; i < total && count < MAX_ENTRIES; ++i) {
    Alarm *alarm = alarm_manager_get_alarm(i);
    if (alarm_get_time(alarm) <= now) {
      continue;
    }
    int j = count++;
    while (j > 0 && alarm_get_time(entries[j - 1]) > alarm_get_time(alarm)) {
      entries[j] = entries[j - 1];
      --j;
    }
    entries[j] = alarm;
  }

  size_t added = 0;
  for (int i = 0; i < count && added < limit; ++i) {
    Alarm *alarm = entries[i];
    time_t when = alarm_get_time(alarm);
    char text[GLANCE_TEXT_SIZE];
    if (alarm_is_timer(alarm)) {
      glance_text_timer(text, sizeof(text), alarm_get_name(alarm), when);
    } else {
      char when_text[32];
      prv_format_alarm_time(when_text, sizeof(when_text), when);
      glance_text_alarm(text, sizeof(text), alarm_get_name(alarm), when_text);
    }
    AppGlanceSlice slice = {
      .layout = {
        .icon = APP_GLANCE_SLICE_DEFAULT_ICON,
        .subtitle_template_string = text,
      },
      .expiration_time = when,
    };
    AppGlanceResult result = app_glance_add_slice(session, slice);
    if (result != APP_GLANCE_RESULT_SUCCESS) {
      BOBBY_LOG(APP_LOG_LEVEL_WARNING, "app_glance_add_slice() returned %d", result);
      continue;
    }
    ++added;
  }
  BOBBY_LOG(APP_LOG_LEVEL_INFO, "Glance shows %d timers and alarms.", (int)added);
}

void glance_update(void) {
  // Also clears the glance when nothing is pending.
  app_glance_reload(prv_reload, NULL);
}

#else

void glance_update(void) {}

#endif
