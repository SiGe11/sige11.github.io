// Entry point: wire the canvas to the game and start the loop.

import { Game } from './game.js';
import { Sfx } from './audio.js';

const canvas = document.querySelector('#game');
if (!canvas) throw new Error('Missing #game canvas element');

// `?seed=123` pins every run on this page to one map and champion, so a run
// can be replayed or shared. Anything that is not a plain integer is ignored.
const seedParam = new URLSearchParams(window.location.search).get('seed') ?? '';
const seed = /^\d{1,10}$/.test(seedParam) ? Number(seedParam) % 4294967296 : null;

const game = new Game(canvas, new Sfx(), { seed });
game.start();

// Handy for debugging from the console; harmless in production.
window.__swarm = game;
