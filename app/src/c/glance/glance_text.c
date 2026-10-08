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

// Builds the subtitle templates for Buddy's launcher glance. Only uses the C library, so it can
// be checked against the firmware's template parser on a computer.

#include "glance_text.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#define ELLIPSIS "\xe2\x80\xa6"

// H:MM:SS from one hour on (hours do not wrap after a day), M:SS below.
#define COUNTDOWN_FORMAT "format(>=1H:'%fH:%0M:%0S','%M:%0S')"

// Appends `count` bytes of `text`, or nothing if they would not fit.
static bool prv_append(char *out, size_t size, size_t *length, const char *text, size_t count) {
  if (*length + count >= size) {
    return false;
  }
  memcpy(out + *length, text, count);
  *length += count;
  out[*length] = '\0';
  return true;
}

// Appends `text` as literal template text: backslashes and braces are escaped, and the text is
// cut after `max_chars` characters (UTF-8 aware) with an ellipsis.
static void prv_append_literal(char *out, size_t size, size_t *length, const char *text,
                               int max_chars) {
  int chars = 0;
  for (const char *p = text; *p; ++p) {
    unsigned char c = (unsigned char)*p;
    bool starts_char = (c & 0xC0) != 0x80;
    if (starts_char) {
      if (chars == max_chars) {
        while (*length > 0 && out[*length - 1] == ' ') {
          out[--*length] = '\0';
        }
        prv_append(out, size, length, ELLIPSIS, strlen(ELLIPSIS));
        return;
      }
      ++chars;
      // Copy a whole character at once so a full buffer never splits it.
      size_t count = 1;
      while (p[count] && ((unsigned char)p[count] & 0xC0) == 0x80) {
        ++count;
      }
      if (c == '\\' || c == '{' || c == '}') {
        if (!prv_append(out, size, length, "\\", 1)) {
          return;
        }
      }
      if (!prv_append(out, size, length, p, count)) {
        return;
      }
      p += count - 1;
    }
  }
}

static const char *prv_label(const char *name, const char *fallback) {
  return (name && name[0]) ? name : fallback;
}

void glance_text_timer(char *out, size_t size, const char *name, time_t end) {
  size_t length = 0;
  out[0] = '\0';
  prv_append_literal(out, size, &length, prv_label(name, "Timer"), GLANCE_NAME_MAX_CHARS);
  // The format itself contains '%', so it must not go through snprintf.
  char countdown[80];
  snprintf(countdown, sizeof(countdown), " {time_until(%ld)|%s}", (long)end, COUNTDOWN_FORMAT);
  prv_append(out, size, &length, countdown, strlen(countdown));
}

void glance_text_alarm(char *out, size_t size, const char *name, const char *when) {
  size_t length = 0;
  out[0] = '\0';
  prv_append_literal(out, size, &length, prv_label(name, "Alarm"), GLANCE_NAME_MAX_CHARS);
  prv_append(out, size, &length, " ", 1);
  prv_append_literal(out, size, &length, when, GLANCE_TEXT_SIZE);
}
