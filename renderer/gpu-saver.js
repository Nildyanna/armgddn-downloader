// Keeps the window light on the graphics card. Shared by the classic and the native window.
//  - "idle": while the window is minimised, hidden or not in front, every running animation is paused (see gpu-saver.css).
//  - "lite": the member's "Lighter graphics" setting; the blur effects and endless animations are turned off.
(function () {
  var root = document.documentElement;
  function idle() { try { root.classList.toggle('idle', document.hidden || !document.hasFocus()); } catch (e) { } }
  document.addEventListener('visibilitychange', idle);
  window.addEventListener('blur', idle);
  window.addEventListener('focus', idle);
  idle();
  window.setLiteGraphics = function (on) { try { root.classList.toggle('lite', !!on); } catch (e) { } };
})();
