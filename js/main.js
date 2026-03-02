// main.js — Bootstrap, UI wiring

window.addEventListener('DOMContentLoaded', function() {
  initWorld();
  Renderer.init();
  Renderer.draw();
  wireControls();
});

function initWorld() {
  World.init(CONFIG.GRID_WIDTH, CONFIG.GRID_HEIGHT);
  World.populate();
}

function wireControls() {
  var playBtn = document.getElementById('btn-play');
  var pauseBtn = document.getElementById('btn-pause');
  var stepBtn = document.getElementById('btn-step');
  var resetBtn = document.getElementById('btn-reset');
  var speedSelect = document.getElementById('speed-select');

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
