// Entry point: wire the canvas to the game and start the loop.

import { Game } from './game.js';
import { Sfx } from './audio.js';

const canvas = document.querySelector('#game');
if (!canvas) throw new Error('Missing #game canvas element');

const game = new Game(canvas, new Sfx());
game.start();

// Handy for debugging from the console; harmless in production.
window.__swarm = game;
