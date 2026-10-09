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

// Cleans up model text for the watch. With `partial` (an answer still being written) only leading
// whitespace is trimmed, so the next piece can follow on directly.
exports.cleanForWatch = function(text, partial) {
    text = String(text || '');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.replace(/\u2022/g, '-');
    text = text.replace(/^\s*[*+]\s+/gm, '- ');
    text = text.replace(/^\s*-\s+/gm, '- ');
    text = text.replace(/^\s{0,3}#{1,6}\s*/gm, '');
    text = text.replace(/\*\*([^*\n][\s\S]*?)\*\*/g, '$1');
    text = text.replace(/__([^_\n][\s\S]*?)__/g, '$1');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
    text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1$2');
    text = text.replace(/`([^`\n]+)`/g, '$1');
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    return partial ? text.replace(/^\s+/, '') : text.trim();
};

exports.forWatch = function(text) {
    return exports.cleanForWatch(text, false);
};
