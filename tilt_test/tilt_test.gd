extends Node2D
## Phone tilt test. Shows what the browser sensors report and moves a ball with "down".
## Open on a real phone. Tap anywhere once to enable sensors (iPhones ask for permission).

const JS_SETUP := """
(function () {
  var t = window.__tilt = {
    n: 0, enabled: false, perm: 'not asked', err: '',
    hasDM: typeof DeviceMotionEvent !== 'undefined',
    needsPerm: (typeof DeviceMotionEvent !== 'undefined') && (typeof DeviceMotionEvent.requestPermission === 'function'),
    iframe: window.self !== window.top, secure: window.isSecureContext,
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    ax: 0, ay: 0, az: 0, lx: 0, ly: 0, lz: 0, beta: 0, gamma: 0, on: 0
  };
  function listen() {
    if (t.enabled) return;
    t.enabled = true;
    window.addEventListener('devicemotion', function (e) {
      var g = e.accelerationIncludingGravity;
      if (!g || g.x === null) return;
      t.n++; t.ax = g.x; t.ay = g.y; t.az = g.z;
    });
    window.addEventListener('deviceorientation', function (e) {
      t.on++; t.beta = e.beta || 0; t.gamma = e.gamma || 0;
    });
  }
  function enable() {
    if (t.enabled || t.perm === 'pending') return;
    if (t.needsPerm) {
      t.perm = 'pending';
      DeviceMotionEvent.requestPermission().then(function (s) {
        t.perm = s;
        if (s === 'granted') {
          listen();
          if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
            DeviceOrientationEvent.requestPermission().catch(function () {});
          }
        }
      }).catch(function (e) { t.perm = 'error'; t.err = String(e); });
    } else {
      t.perm = 'not needed'; listen();
    }
  }
  // Must run inside the real touch/click handler so iOS accepts the permission request.
  ['touchend', 'click'].forEach(function (n) { document.addEventListener(n, enable, true); });
})();
"""

var is_web := false
var js_tilt: JavaScriptObject
var ball := Vector2(640, 360)
var vel := Vector2.ZERO
var touch_pos := Vector2.INF
var label: Label
var started_ms := 0
var down := Vector2.ZERO   # screen-space "down" built from the sensor, unit-ish (0..1)


func _ready() -> void:
	is_web = OS.has_feature("web")
	label = Label.new()
	label.position = Vector2(16, 12)
	label.add_theme_font_size_override("font_size", 22)
	add_child(label)
	if is_web:
		JavaScriptBridge.eval(JS_SETUP, true)
		js_tilt = JavaScriptBridge.get_interface("__tilt")
	started_ms = Time.get_ticks_msec()


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch or event is InputEventMouseButton:
		touch_pos = event.position if event.pressed else Vector2.INF
	elif (event is InputEventScreenDrag or event is InputEventMouseMotion) and touch_pos != Vector2.INF:
		touch_pos = event.position


func _sensor_down() -> Vector2:
	# Browser x points to the right of the screen, y to the top (portrait).
	# Android reports acceleration opposite to gravity, iOS the other way round.
	var sign := 1.0 if js_tilt.ios else -1.0
	var ax: float = sign * js_tilt.ax
	var ay: float = sign * js_tilt.ay
	return Vector2(ax, -ay) / 9.81


func _process(delta: float) -> void:
	var have_sensor := is_web and js_tilt != null and int(js_tilt.n) > 0
	if have_sensor:
		down = _sensor_down()
	elif touch_pos != Vector2.INF:
		down = (touch_pos - ball).normalized()
	else:
		var k := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
		down = k
	vel += down * 1400.0 * delta
	vel *= 0.995
	ball += vel * delta
	var size := get_viewport_rect().size
	var r := 28.0
	if ball.x < r: ball.x = r; vel.x = -vel.x * 0.7
	if ball.x > size.x - r: ball.x = size.x - r; vel.x = -vel.x * 0.7
	if ball.y < r: ball.y = r; vel.y = -vel.y * 0.7
	if ball.y > size.y - r: ball.y = size.y - r; vel.y = -vel.y * 0.7
	label.text = _report(have_sensor)
	queue_redraw()


func _report(have_sensor: bool) -> String:
	var s := "TILT TEST  (tap once to enable sensors)\n"
	if not is_web:
		return s + "not a web build: use arrow keys or hold the mouse.\ndown = %s" % down.snapped(Vector2(0.01, 0.01))
	var secs := (Time.get_ticks_msec() - started_ms) / 1000.0
	s += "web build. in iframe: %s  secure: %s  ios: %s\n" % [js_tilt.iframe, js_tilt.secure, js_tilt.ios]
	s += "DeviceMotion exists: %s  needs permission: %s\n" % [js_tilt.hasDM, js_tilt.needsPerm]
	s += "permission: %s  %s\n" % [js_tilt.perm, js_tilt.err]
	s += "motion events: %d  orientation events: %d\n" % [int(js_tilt.n), int(js_tilt.on)]
	s += "accel incl gravity  x %.2f  y %.2f  z %.2f\n" % [js_tilt.ax, js_tilt.ay, js_tilt.az]
	s += "beta %.0f  gamma %.0f\n" % [js_tilt.beta, js_tilt.gamma]
	s += "down = (%.2f, %.2f)\n" % [down.x, down.y]
	if have_sensor:
		s += "RESULT: SENSOR WORKS. Tilt the phone: the ball should roll downhill."
	elif int(js_tilt.n) == 0 and secs > 6.0:
		s += "RESULT: NO SENSOR DATA. Using touch fallback: hold a finger to pull the ball."
	return s


func _draw() -> void:
	var size := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, size), Color("#1c1f33"))
	draw_circle(ball, 28.0, Color("#ffcf4a"))
	draw_circle(ball + Vector2(-8, -8), 8.0, Color("#fff3b8"))
	var c := size / 2.0
	draw_line(c, c + down * 120.0, Color("#6fd0ff"), 4.0)
	draw_circle(c + down * 120.0, 7.0, Color("#6fd0ff"))
