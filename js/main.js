// main.js — Bootstrap, UI wiring

var activeScenario = 'default';

// Species with adjustable starting group counts
var SPAWN_SPECIES = ['rabbit', 'deer', 'pig', 'bear', 'fox', 'wolf', 'stone'];
var SPAWN_CONFIG_KEY = {
  rabbit: 'INITIAL_RABBIT', deer: 'INITIAL_DEER', pig: 'INITIAL_PIG',
  bear: 'INITIAL_BEAR', fox: 'INITIAL_FOX', wolf: 'INITIAL_WOLF',
  stone: 'INITIAL_STONE',
};

window.addEventListener('DOMContentLoaded', function() {
  Scenarios.captureDefaults();
  initWorld();
  Renderer.init();
  Renderer.draw();
  wireControls();
});

function initWorld() {
  Scenarios.apply(activeScenario);
  Rng.seed(CONFIG.RNG_SEED);
  World.init(CONFIG.GRID_WIDTH, CONFIG.GRID_HEIGHT);
  World.populate();
}

function doReset(playBtn, pauseBtn) {
  Simulation.stop();
  while (Renderer.gridEl.firstChild) {
    Renderer.gridEl.removeChild(Renderer.gridEl.firstChild);
  }
  initWorld();
  Renderer.init();
  Renderer.draw();
  pauseBtn.classList.add('active');
  playBtn.classList.remove('active');
}

function wireControls() {
  var playBtn = document.getElementById('btn-play');
  var pauseBtn = document.getElementById('btn-pause');
  var stepBtn = document.getElementById('btn-step');
  var resetBtn = document.getElementById('btn-reset');
  var speedSelect = document.getElementById('speed-select');
  var scenarioSelect = document.getElementById('scenario-select');
  var scenarioDesc = document.getElementById('scenario-desc');
  var spawnPanel = document.getElementById('spawn-panel');

  // --- Spawn panel: per-species starting group count adjusters ---
  var spawnValueEls = {};

  function buildSpawnPanel() {
    spawnPanel.innerHTML = '';
    for (var i = 0; i < SPAWN_SPECIES.length; i++) {
      var species = SPAWN_SPECIES[i];
      var tmpl = TEMPLATES[species];
      var configKey = SPAWN_CONFIG_KEY[species];
      var val = CONFIG[configKey];

      var item = document.createElement('span');
      item.className = 'spawn-item';

      var icon = document.createElement('span');
      icon.className = 'spawn-icon';
      icon.style.color = tmpl.color;
      icon.textContent = tmpl.symbol;

      var name = document.createElement('span');
      name.className = 'spawn-name';
      name.textContent = species;

      var btnMinus = document.createElement('button');
      btnMinus.className = 'spawn-btn';
      btnMinus.textContent = '-';
      btnMinus.dataset.species = species;
      btnMinus.dataset.delta = '-1';

      var valSpan = document.createElement('span');
      valSpan.className = 'spawn-val';
      valSpan.textContent = val;
      spawnValueEls[species] = valSpan;

      var btnPlus = document.createElement('button');
      btnPlus.className = 'spawn-btn';
      btnPlus.textContent = '+';
      btnPlus.dataset.species = species;
      btnPlus.dataset.delta = '1';

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(btnMinus);
      item.appendChild(valSpan);
      item.appendChild(btnPlus);
      spawnPanel.appendChild(item);
    }
  }

  function updateSpawnValues() {
    for (var i = 0; i < SPAWN_SPECIES.length; i++) {
      var species = SPAWN_SPECIES[i];
      var configKey = SPAWN_CONFIG_KEY[species];
      if (spawnValueEls[species]) {
        spawnValueEls[species].textContent = CONFIG[configKey];
      }
    }
  }

  spawnPanel.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn.classList.contains('spawn-btn')) return;
    var species = btn.dataset.species;
    var delta = parseInt(btn.dataset.delta);
    var configKey = SPAWN_CONFIG_KEY[species];
    CONFIG[configKey] = Math.max(0, CONFIG[configKey] + delta);
    updateSpawnValues();
  });

  buildSpawnPanel();

  // --- Scenario dropdown ---
  var names = Scenarios.list();
  for (var i = 0; i < names.length; i++) {
    var opt = document.createElement('option');
    opt.value = names[i];
    opt.textContent = SCENARIO_DEFS[names[i]].label;
    if (names[i] === activeScenario) opt.selected = true;
    scenarioSelect.appendChild(opt);
  }
  updateScenarioDesc();

  function updateScenarioDesc() {
    var def = SCENARIO_DEFS[activeScenario];
    if (def && def.desc) {
      scenarioDesc.textContent = def.desc;
      scenarioDesc.style.display = '';
    } else {
      scenarioDesc.style.display = 'none';
    }
  }

  scenarioSelect.addEventListener('change', function() {
    activeScenario = scenarioSelect.value;
    updateScenarioDesc();
    // Apply scenario then refresh spawn panel to show new values
    Scenarios.apply(activeScenario);
    updateSpawnValues();
    doReset(playBtn, pauseBtn);
  });

  playBtn.addEventListener('click', function() {
    Simulation.start();
    playBtn.classList.add('active');
    pauseBtn.classList.remove('active');
  });

  pauseBtn.addEventListener('click', function() {
    Simulation.stop();
    pauseBtn.classList.add('active');
    playBtn.classList.remove('active');
  });

  stepBtn.addEventListener('click', function() {
    Simulation.stop();
    Simulation.step();
    pauseBtn.classList.add('active');
    playBtn.classList.remove('active');
  });

  resetBtn.addEventListener('click', function() {
    doReset(playBtn, pauseBtn);
  });

  speedSelect.addEventListener('change', function() {
    var idx = parseInt(speedSelect.value);
    Simulation.setSpeed(CONFIG.SPEED_OPTIONS[idx]);
  });
}
