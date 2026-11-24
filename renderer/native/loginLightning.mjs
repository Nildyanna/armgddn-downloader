// The website's full-screen lightning reveal (bolts and sparks around the logo, ember glow, thunder), ported unchanged apart from the asset paths.
// Plays once after a first sign-in and can be replayed from Settings. Copied from the website's default.php (mountLoginLightning).
let _loginLightningActive = null;
const LOGIN_LIGHTNING_REAL_SRC = 'login-thunder.ogg';   // Opus, 0.46 MB (was a 4.8 MB WAV, Nov 24 2026); the website keeps this in its page; the port forgot it and the intro never started

        function mountLoginLightningInner() {
            // Guard against double-mount (e.g. rapid double-click on the replay button).
            if (_loginLightningActive) return;
            if (document.getElementById('loginLightningStage')) return;

            const rand = (min, max) => min + Math.random() * (max - min);
            const LIGHTNING_COLOR = '#5EEBFF';
            const SPARK_INTENSITY = 3;
            const FALLBACK_DURATION = 27.33; // seconds — matches login-thunder.ogg
            const HOLD_EXTRA = 1.6; // seconds of continued crackle after audio ends

            const stage = document.createElement('div');
            stage.id = 'loginLightningStage';

            const emberWrap = document.createElement('div');
            emberWrap.className = 'login-lightning-ember';
            const emberGlow = document.createElement('div');
            emberGlow.className = 'login-lightning-ember-glow';
            emberWrap.appendChild(emberGlow);

            const canvasBehind = document.createElement('canvas');
            canvasBehind.id = 'loginLightningCanvasBehind';
            const logo = document.createElement('img');
            logo.id = 'loginLightningLogo';
            logo.src = 'login-lightning-logo.png';
            logo.alt = 'Armgddn Games';
            const canvasFront = document.createElement('canvas');
            canvasFront.id = 'loginLightningCanvasFront';

            // Reuse the shared, page-level audio element rather than creating a fresh
            // one — a freshly created element wouldn't carry over the "unlocked"
            // autoplay-with-sound permission established by tryUnlockLoginLightningAudio().
            const audio = (() => {
                const el = document.createElement('audio');
                el.src = LOGIN_LIGHTNING_REAL_SRC;
                el.preload = 'auto';
                return el;
            })();

            const overlay = document.createElement('div');
            overlay.id = 'loginLightningOverlay';

            stage.appendChild(emberWrap);
            stage.appendChild(canvasBehind);
            stage.appendChild(logo);
            stage.appendChild(canvasFront);
            stage.appendChild(audio);
            stage.appendChild(overlay);
            document.body.appendChild(stage);

            const state = {
                boltsBehind: [],
                boltsFront: [],
                sparks: [],
                clock: 0,
                nextBoltTime: 0.4,
                lastTs: 0,
                transitioning: false,
                raf: null,
            };

            function resize() {
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                [canvasBehind, canvasFront].forEach((c) => {
                    c.width = window.innerWidth * dpr;
                    c.height = window.innerHeight * dpr;
                    const ctx = c.getContext('2d');
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                });
            }
            resize();
            const onResize = () => resize();
            window.addEventListener('resize', onResize);

            function getDuration() {
                const d = audio.duration;
                return (isFinite(d) && d > 0) ? d : FALLBACK_DURATION;
            }

            function subdivide(p1, p2, disp, depth, out) {
                if (depth <= 0) { out.push(p2); return; }
                const mx = (p1[0] + p2[0]) / 2 + rand(-disp, disp);
                const my = (p1[1] + p2[1]) / 2 + rand(-disp, disp);
                subdivide(p1, [mx, my], disp * 0.55, depth - 1, out);
                subdivide([mx, my], p2, disp * 0.55, depth - 1, out);
            }

            function makeBoltPoints(x1, y1, x2, y2) {
                const dist = Math.hypot(x2 - x1, y2 - y1);
                const out = [[x1, y1]];
                subdivide([x1, y1], [x2, y2], Math.max(6, dist * 0.16), 4, out);
                return out;
            }

            function spawnSparks(x, y, normalAngle) {
                const intensity = SPARK_INTENSITY;
                const n = Math.round(rand(7, 13) * (0.6 + intensity * 0.28));
                for (let i = 0; i < n; i++) {
                    const ang = normalAngle + rand(-1.1, 1.1);
                    const speed = rand(70, 240);
                    state.sparks.push({
                        x, y,
                        vx: Math.cos(ang) * speed,
                        vy: Math.sin(ang) * speed,
                        born: performance.now(),
                        life: rand(320, 650),
                        size: rand(1.5, 3.4),
                    });
                }
            }

            function spawnRandomBolt() {
                const rect = logo.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const R = (rect.width / 2) * 0.95;

                const r = Math.random();
                const type = r < 0.4 ? 'behind' : (r < 0.75 ? 'front' : 'strike');
                const a1 = rand(0, Math.PI * 2);
                const outerR = R * rand(1.5, 2.6);
                const x1 = cx + Math.cos(a1) * outerR;
                const y1 = cy + Math.sin(a1) * outerR;

                let x2, y2, layer;
                if (type === 'strike') {
                    const a2s = rand(0, Math.PI * 2);
                    x2 = cx + Math.cos(a2s) * R;
                    y2 = cy + Math.sin(a2s) * R;
                    layer = 'front';
                } else {
                    const a2 = a1 + rand(-1.3, 1.3);
                    const r2 = R * rand(1.1, 1.8);
                    x2 = cx + Math.cos(a2) * r2;
                    y2 = cy + Math.sin(a2) * r2;
                    layer = type;
                }

                const points = makeBoltPoints(x1, y1, x2, y2);
                const branches = [];
                points.forEach((p, i) => {
                    if (i > 0 && i < points.length - 1 && Math.random() < 0.18) {
                        const ang = Math.atan2(y2 - y1, x2 - x1) + rand(-1.1, 1.1);
                        const len = rand(14, 40);
                        const bx = p[0] + Math.cos(ang) * len;
                        const by = p[1] + Math.sin(ang) * len;
                        branches.push([p, [bx, by]]);
                    }
                });

                const bolt = { points, branches, born: performance.now(), life: rand(160, 260) };
                (layer === 'behind' ? state.boltsBehind : state.boltsFront).push(bolt);

                if (type === 'strike') {
                    const normalAngle = Math.atan2(y2 - cy, x2 - cx);
                    spawnSparks(x2, y2, normalAngle);
                }
            }

            function drawBolt(ctx, bolt, now, color) {
                const age = now - bolt.born;
                if (age > bolt.life) return false;
                const lr = age / bolt.life;
                let alpha = lr < 0.15 ? lr / 0.15 : Math.max(0, 1 - (lr - 0.15) / 0.85);
                alpha *= (0.7 + 0.3 * Math.random());
                ctx.save();
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.shadowColor = color;
                ctx.shadowBlur = 18;
                ctx.globalAlpha = Math.min(1, alpha);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                bolt.points.forEach((p, i) => { i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); });
                ctx.stroke();
                ctx.globalAlpha = Math.min(1, alpha) * 0.9;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
                bolt.branches.forEach((br) => {
                    ctx.beginPath();
                    ctx.moveTo(br[0][0], br[0][1]);
                    ctx.lineTo(br[1][0], br[1][1]);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.3;
                    ctx.globalAlpha = Math.min(1, alpha) * 0.65;
                    ctx.stroke();
                });
                ctx.restore();
                return true;
            }

            function drawSpark(ctx, s, now) {
                const age = now - s.born;
                if (age > s.life) return false;
                const t = age / 1000;
                const x = s.x + s.vx * t;
                const y = s.y + s.vy * t + 0.5 * 500 * t * t;
                const alpha = Math.max(0, 1 - age / s.life);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = '#fff4d6';
                ctx.shadowColor = '#ffcf7a';
                ctx.shadowBlur = 7;
                ctx.beginPath();
                ctx.arc(x, y, s.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                return true;
            }

            function teardown() {
                cancelAnimationFrame(state.raf);
                window.removeEventListener('resize', onResize);
                try { audio.pause(); } catch (e) {}
                if (stage.parentNode) stage.parentNode.removeChild(stage);
                _loginLightningActive = null;
            }

            function startTransition() {
                state.transitioning = true;
                overlay.style.transition = 'opacity 900ms ease';
                overlay.style.opacity = '1';
                setTimeout(() => {
                    // Overlay is now fully opaque (black covers the whole screen).
                    // Hard-hide the logo/canvases/ember glow via CSS before doing anything
                    // else, so there is zero possibility of them being visible once the
                    // overlay starts fading back out — this is what guarantees the logo
                    // can never "return"/flash at the end of the reveal.
                    stage.classList.add('login-lightning-teardown');
                    cancelAnimationFrame(state.raf);
                    try { audio.pause(); } catch (e) {}

                    stage.dispatchEvent(new CustomEvent('armgddn:login-complete', { bubbles: true }));

                    // Fade the (now-empty, fully black) overlay back out to reveal the real
                    // app underneath, which was never touched — it's been rendering the
                    // whole time beneath the opaque overlay.
                    requestAnimationFrame(() => {
                        overlay.style.transition = 'opacity 700ms ease';
                        overlay.style.opacity = '0';
                        setTimeout(() => {
                            // Fully remove the stage from the DOM — nothing left to flash back.
                            teardown();
                        }, 750);
                    });
                }, 950);
            }

            function tick(ts) {
                state.ticked = true;
                if (!state.lastTs) state.lastTs = ts;
                const dt = (ts - state.lastTs) / 1000;
                state.lastTs = ts;

                if (audio && !audio.paused && !audio.ended) {
                    state.clock = audio.currentTime;
                } else if (!state.transitioning) {
                    state.clock += dt;
                }

                const dur = getDuration();
                const progress = Math.max(0, Math.min(1, state.clock / dur));
                const eased = progress >= 1 ? 1 : 1 - Math.pow(1 - progress, 1.6);
                logo.style.opacity = String(eased);

                if (state.clock >= state.nextBoltTime) {
                    spawnRandomBolt();
                    const freqMult = (0.55 + SPARK_INTENSITY * 0.32) * (1 + progress * 0.6);
                    state.nextBoltTime = state.clock + rand(0.45, 1.9) / freqMult;
                }

                if (!state.transitioning && state.clock >= dur + HOLD_EXTRA) {
                    startTransition();
                }

                const color = LIGHTNING_COLOR;
                const now = performance.now();
                const ctxB = canvasBehind.getContext('2d');
                const ctxF = canvasFront.getContext('2d');

                ctxB.clearRect(0, 0, window.innerWidth, window.innerHeight);
                state.boltsBehind = state.boltsBehind.filter((b) => drawBolt(ctxB, b, now, color));

                ctxF.clearRect(0, 0, window.innerWidth, window.innerHeight);
                state.boltsFront = state.boltsFront.filter((b) => drawBolt(ctxF, b, now, color));
                state.sparks = state.sparks.filter((s) => drawSpark(ctxF, s, now));

                if (!state.transitioning) {
                    state.raf = requestAnimationFrame(tick);
                }
            }

            // Explicit guarantee: the real thunder sound only ever plays alongside the
            // actual visual reveal. Force the real src (in case the unlock-priming swap
            // was still in flight and hadn't restored it yet) and confirm the stage is
            // genuinely attached to the document before playing anything audible.
            if (!stage.isConnected) {
                console.warn('[LoginLightning] Stage not attached to document — skipping audio playback');
            } else try {
                audio.src = LOGIN_LIGHTNING_REAL_SRC;
                audio.volume = 1;
                audio.muted = false;
                try { audio.currentTime = 0; } catch (e) {}
                const playPromise = audio.play();
                if (playPromise && playPromise.catch) {
                    playPromise.catch(() => {
                        // Autoplay-with-sound was blocked. No visible prompt — the animation
                        // still plays on its own timeline via the fallback duration below.
                        // Silently retry on the next click/keydown in case the user interacts
                        // anyway, so sound can still recover without any UI nag.
                        const resume = () => {
                            audio.play().catch(() => {});
                            window.removeEventListener('click', resume);
                            window.removeEventListener('keydown', resume);
                        };
                        window.addEventListener('click', resume, { once: true });
                        window.addEventListener('keydown', resume, { once: true });
                    });
                }
            } catch (audioError) {
                console.warn('[LoginLightning] sound could not start, the animation runs without it: ' + (audioError && audioError.message));
            }

            state.raf = requestAnimationFrame(tick);
            _loginLightningActive = { teardown };
            // Safety net: if the animation loop has not drawn a single frame within four seconds, take the stage down instead of leaving it on top.
            setTimeout(() => {
                if (!state.ticked && _loginLightningActive && _loginLightningActive.teardown === teardown) {
                    console.warn('[LoginLightning] the animation did not start; removing the stage');
                    teardown();
                }
            }, 4000);
        }

        // Starts the reveal. Whatever goes wrong inside, the full-screen stage is removed again so the app can never be left covered.
        export function mountLoginLightning() {
            try { mountLoginLightningInner(); }
            catch (e) {
                console.warn('[LoginLightning] could not start: ' + (e && e.message ? e.message : e));
                try { const st = document.getElementById('loginLightningStage'); if (st && st.parentNode) st.parentNode.removeChild(st); } catch (e2) { }
                _loginLightningActive = null;
            }
        }
