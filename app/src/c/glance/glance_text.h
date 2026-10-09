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

#pragma once

#include <stddef.h>
#include <time.h>

// The launcher accepts subtitle templates of at most 150 bytes including the terminator.
#define GLANCE_TEXT_SIZE 150

// Names are shortened to this many characters so the time stays visible in the launcher.
#define GLANCE_NAME_MAX_CHARS 14

// "Timer 4:30" or "<name> 4:30", counting down to `end` (the launcher updates it every second).
void glance_text_timer(char *out, size_t size, const char *name, time_t end);

// "Alarm <when>" or "<name> <when>", where `when` is the already formatted alarm time.
void glance_text_alarm(char *out, size_t size, const char *name, const char *when);
