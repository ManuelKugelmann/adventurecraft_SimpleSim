// main.js — Bootstrap, UI wiring

var activeScenario = 'default';

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

function wireControls() {
  var playBtn = document.getElementById('btn-play');
  var pauseBtn = document.getElementById('btn-pause');
  var stepBtn = document.getElementById('btn-step');
  var resetBtn = document.getElementById('btn-reset');
  var speedSelect = document.getElementById('speed-select');
  var scenarioSelect = document.getElementById('scenario-select');
  var scenarioDesc = document.getElementById('scenario-desc');

  // Populate scenario dropdown
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
    // Auto-reset on scenario change
    Simulation.stop();
    while (Renderer.gridEl.firstChild) {
      Renderer.gridEl.removeChild(Renderer.gridEl.firstChild);
    }
    initWorld();
    Renderer.init();
    Renderer.draw();
    pauseBtn.classList.add('active');
    playBtn.classList.remove('active');
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
    Simulation.stop();
    // Clear grid
    while (Renderer.gridEl.firstChild) {
      Renderer.gridEl.removeChild(Renderer.gridEl.firstChild);
    }
    initWorld();
    Renderer.init();
    Renderer.draw();
    pauseBtn.classList.add('active');
    playBtn.classList.remove('active');
  });

  speedSelect.addEventListener('change', function() {
    var idx = parseInt(speedSelect.value);
    Simulation.setSpeed(CONFIG.SPEED_OPTIONS[idx]);
  });
}
