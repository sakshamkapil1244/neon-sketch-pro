'use strict';

const BANK = {
  easy: [
    'sun','moon','star','tree','house','car','apple','banana','fish','cat','dog','ball','book',
    'chair','flower','cloud','key','bed','egg','hat','shoe','cup','bus','clock','heart','chai',
    'samosa','kite','mango','cow','spoon','door','pencil','bird','snake'
  ],
  medium: [
    'rocket','robot','guitar','pizza','burger','camera','computer','phone','umbrella','crown',
    'sword','elephant','giraffe','penguin','dragon','shark','dolphin','octopus','turtle','monkey',
    'tiger','owl','butterfly','spider','ghost','snowman','pumpkin','castle','bridge','train',
    'airplane','bicycle','trophy','tractor','biryani','diya','rangoli','cricket bat','ice cream',
    'auto rickshaw','birthday cake','football'
  ],
  hard: [
    'lighthouse','windmill','skateboard','headphones','microphone','backpack','telescope','compass',
    'magnet','light bulb','tornado','cactus','volcano','island','rainbow','submarine','kangaroo',
    'vampire','alien','ninja','taj mahal','space station','hot air balloon','treasure map',
    'police car','fire truck','gulab jamun','mehndi','time machine','black hole','roller coaster',
    'scarecrow','parachute','snow globe'
  ]
};

const MULTIPLIER = { easy: 1, medium: 1.25, hard: 1.5 };

const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

function pickChoices(used = new Set()) {
  return ['easy', 'medium', 'hard'].map(diff => {
    let pool = BANK[diff].filter(w => !used.has(w));
    if (!pool.length) pool = BANK[diff];
    return { word: rnd(pool), diff };
  });
}

module.exports = { BANK, MULTIPLIER, pickChoices };