// snapshot.js — Read/write separation via state snapshots
// Before each rule layer, capture mutable node state (vitals, count, alive).
// Rules and sense model read from the snapshot; effects write to live nodes.
// This ensures iteration order within a layer doesn't affect outcomes.
// Post-layer: clamp negative counts, mark dead nodes.

var Snapshot = {
  _data: null,

  // Capture mutable state of all living nodes before a layer executes
  capture: function() {
    var data = new Map();
    World.nodes.forEach(function(node) {
      if (!node.alive) return;
      var entry = { count: node.count, alive: true };
      if (node.traits.vitals) {
        var v = node.traits.vitals;
        var snap = {};
        var keys = Object.keys(v);
        for (var i = 0; i < keys.length; i++) {
          snap[keys[i]] = v[keys[i]];
        }
        entry.vitals = snap;
      }
      data.set(node.id, entry);
    });
    this._data = data;
  },

  // Whether a snapshot is currently active
  active: function() {
    return this._data !== null;
  },

  // Read snapshot vitals for a node (returns snapshot copy or null)
  vitals: function(nodeId) {
    var entry = this._data ? this._data.get(nodeId) : null;
    return entry ? entry.vitals || null : null;
  },

  // Read snapshot count for a node
  count: function(nodeId) {
    var entry = this._data ? this._data.get(nodeId) : null;
    return entry !== undefined && entry !== null ? entry.count : 0;
  },

  // Read snapshot alive status for a node
  alive: function(nodeId) {
    var entry = this._data ? this._data.get(nodeId) : null;
    return entry ? entry.alive : false;
  },

  // Release snapshot after layer completes
  clear: function() {
    this._data = null;
  },

  // Post-layer: clamp negative counts to 0, mark nodes with count<=0 as dead.
  // Effects may over-decrement when multiple actors consume the same source
  // simultaneously (intentional: parallel execution model).
  clampCounts: function() {
    World.nodes.forEach(function(node) {
      if (!node.alive) return;
      if (node.count < 0) node.count = 0;
      if (node.count <= 0) {
        var tmpl = TEMPLATES[node.templateId];
        if (tmpl.category !== 'terrain' && tmpl.category !== 'tilegroup') {
          dropContained(node);
          node.alive = false;
        }
      }
    });
  },
};
