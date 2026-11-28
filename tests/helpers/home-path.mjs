// Builds a home-relative expected path with the host separator (#544).
import path from 'node:path';

export function tildePath(...parts) {
  return ['~', ...parts].join(path.sep);
}