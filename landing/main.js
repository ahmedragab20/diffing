/* ════════════════════════════════════════════════════════════════════════
   diffing landing page — main.js
   Vanilla ES (IIFE). No frameworks. Works from file://.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var LS = {
    audio: "diffing-landing-audio",
    haptics: "diffing-landing-haptics",
    theme: "diffing-landing-theme",
  };
  function lsGet(k, fb) {
    try {
      var v = localStorage.getItem(k);
      return v === null ? fb : v;
    } catch (e) {
      return fb;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }

  var prefersReduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── State ────────────────────────────────────────────────────────────
  var state = {
    audio: lsGet(LS.audio, "on") === "on",
    haptics: lsGet(LS.haptics, "on") === "on",
  };

  // ════════════════════════════════════════════════════════════════════
  // AUDIO — synth() ported VERBATIM from src/ui/hooks/useHaptics.tsx
  // ════════════════════════════════════════════════════════════════════
  var _audioCtx = null;
  function getAudioCtx() {
    if (typeof window === "undefined") return null;
    if (_audioCtx) return _audioCtx;
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      _audioCtx = null;
    }
    return _audioCtx;
  }

  function synth(ctx, preset) {
    var t = ctx.currentTime;
    var d = ctx.destination;

    var note = function (freq, type, vol, delay, dur, freqEnd) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.connect(g);
      g.connect(d);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t + delay);
      if (freqEnd !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(freqEnd, t + delay + dur);
      }
      g.gain.setValueAtTime(vol, t + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
      osc.start(t + delay);
      osc.stop(t + delay + dur);
    };

    switch (preset) {
      case "click":
        note(700, "sine", 0.16, 0, 0.03, 350);
        break;
      case "toggle":
        note(460, "square", 0.06, 0, 0.04, 230);
        break;
      case "navigate":
        note(520, "sine", 0.07, 0, 0.02);
        break;
      case "open":
        note(210, "sine", 0.12, 0, 0.13, 560);
        break;
      case "close":
        note(560, "sine", 0.1, 0, 0.11, 210);
        break;
      case "success":
        note(523, "sine", 0.17, 0, 0.1); // C5
        note(784, "sine", 0.17, 0.09, 0.13); // G5
        break;
      case "resolve":
        note(659, "sine", 0.15, 0, 0.1); // E5
        note(988, "sine", 0.15, 0.09, 0.13); // B5
        break;
      case "send":
        note(523, "sine", 0.15, 0, 0.1); // C5
        note(659, "sine", 0.15, 0.07, 0.1); // E5
        note(784, "sine", 0.15, 0.14, 0.14); // G5
        break;
      case "error":
        note(280, "sawtooth", 0.16, 0, 0.15, 80);
        break;
      case "warning":
        note(330, "sine", 0.13, 0, 0.09);
        note(330, "sine", 0.09, 0.12, 0.09);
        break;
      case "remove":
        note(380, "sine", 0.13, 0, 0.08, 140);
        break;
    }
  }

  // Sound preset captions (note params, for the lab UI)
  var SOUND_CAPTIONS = {
    click: "700→350Hz sine 30ms",
    toggle: "460→230Hz square 40ms",
    navigate: "520Hz sine 20ms",
    open: "210→560Hz sine 130ms",
    close: "560→210Hz sine 110ms",
    success: "C5→G5 sine",
    resolve: "E5→B5 sine",
    send: "C5-E5-G5 arpeggio",
    error: "280→80Hz saw 150ms",
    warning: "330Hz ×2 sine",
    remove: "380→140Hz sine 80ms",
  };
  var SOUND_PRESETS = [
    "click",
    "toggle",
    "navigate",
    "open",
    "close",
    "success",
    "resolve",
    "send",
    "error",
    "warning",
    "remove",
  ];

  function playSound(preset) {
    if (!state.audio) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    var work = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    work
      .then(function () {
        try {
          synth(ctx, preset);
        } catch (e) {}
      })
      .catch(function () {});
  }

  // ════════════════════════════════════════════════════════════════════
  // HAPTICS — navigator.vibrate patterns mapped from the 10 HapticPreset names
  // ════════════════════════════════════════════════════════════════════
  var HAPTIC_PATTERNS = {
    selection: 8,
    light: 10,
    soft: 12,
    medium: 18,
    rigid: 22,
    heavy: 30,
    nudge: [6, 40, 6],
    success: [12, 30, 18],
    warning: [20, 40, 20],
    error: [30, 30, 30, 30, 40],
  };
  var HAPTIC_PRESETS = [
    "success",
    "warning",
    "error",
    "light",
    "medium",
    "heavy",
    "soft",
    "rigid",
    "selection",
    "nudge",
  ];

  function fireHaptic(preset) {
    if (!state.haptics) return;
    if (!("vibrate" in navigator)) return;
    var pat = HAPTIC_PATTERNS[preset] || HAPTIC_PATTERNS.selection;
    try {
      navigator.vibrate(pat);
    } catch (e) {}
  }

  function feedback(haptic, sound) {
    fireHaptic(haptic || "selection");
    playSound(sound || "click");
  }

  // ════════════════════════════════════════════════════════════════════
  // Global capture-phase click listener (ported from useHaptics.tsx:210-232)
  // ════════════════════════════════════════════════════════════════════
  document.addEventListener(
    "click",
    function (e) {
      var target = e.target;
      var el =
        target && target.closest
          ? target.closest(
              'button, a[href], [role="button"], input[type="checkbox"], [role="option"]'
            )
          : null;
      if (!el || el.disabled) return;
      var isCheckbox = el.tagName === "INPUT" && el.type === "checkbox";
      if (state.haptics) fireHaptic("selection");
      if (state.audio) {
        var ctx = getAudioCtx();
        if (ctx) {
          var work =
            ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
          work
            .then(function () {
              try {
                synth(ctx, isCheckbox ? "toggle" : "click");
              } catch (er) {}
            })
            .catch(function () {});
        }
      }
    },
    true
  );

  // Resume audio context on first user gesture
  function resumeAudioOnce() {
    var ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(function () {});
    window.removeEventListener("pointerdown", resumeAudioOnce);
    window.removeEventListener("keydown", resumeAudioOnce);
  }
  window.addEventListener("pointerdown", resumeAudioOnce);
  window.addEventListener("keydown", resumeAudioOnce);

  // ════════════════════════════════════════════════════════════════════
  // Status-strip toggles
  // ════════════════════════════════════════════════════════════════════
  function syncToggle(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var dot = btn.querySelector(".dot");
    var label = btn.querySelector(".toggle-state");
    if (dot) {
      dot.className = "dot " + (on ? "dot-on" : "dot-off");
    }
    if (label) {
      label.textContent = on ? "ON" : "OFF";
    }
  }
  var audioToggle = document.getElementById("audio-toggle");
  var hapticsToggle = document.getElementById("haptics-toggle");
  syncToggle(audioToggle, state.audio);
  syncToggle(hapticsToggle, state.haptics);
  audioToggle.addEventListener("click", function () {
    state.audio = !state.audio;
    lsSet(LS.audio, state.audio ? "on" : "off");
    syncToggle(audioToggle, state.audio);
    if (state.audio) playSound("toggle");
  });
  hapticsToggle.addEventListener("click", function () {
    state.haptics = !state.haptics;
    lsSet(LS.haptics, state.haptics ? "on" : "off");
    syncToggle(hapticsToggle, state.haptics);
    fireHaptic("medium");
  });

  // ════════════════════════════════════════════════════════════════════
  // THEMES — 5 previewed (the verbatim embedded blocks); 't' / 'g t' cycle
  // ════════════════════════════════════════════════════════════════════
  var THEMES = [
    {
      id: "nord",
      name: "Nord",
      bg: "#2e3440",
      sec: "#242933",
      acc: "#88c0d0",
      ext: "#b48ead",
    },
    {
      id: "catppuccin-mocha",
      name: "Catppuccin Mocha",
      bg: "#1e1e2e",
      sec: "#181825",
      acc: "#cba6f7",
      ext: "#f5c2e7",
    },
    {
      id: "tokyo-night",
      name: "Tokyo Night",
      bg: "#1a1b26",
      sec: "#16161e",
      acc: "#7aa2f7",
      ext: "#bb9af7",
    },
    {
      id: "dracula",
      name: "Dracula",
      bg: "#282a36",
      sec: "#1e1f29",
      acc: "#bd93f9",
      ext: "#ff79c6",
    },
    {
      id: "rose-pine",
      name: "Rosé Pine",
      bg: "#191724",
      sec: "#1f1d2e",
      acc: "#c4a7e7",
      ext: "#ea9a97",
    },
  ];
  var currentTheme = lsGet(LS.theme, "nord");
  if (
    !THEMES.some(function (t) {
      return t.id === currentTheme;
    })
  )
    currentTheme = "nord";

  var vimThemeEl = document.getElementById("vim-theme");

  function applyTheme(id, withSound) {
    document.documentElement.classList.add("theme-switching");
    document.documentElement.setAttribute("data-theme", id);
    currentTheme = id;
    lsSet(LS.theme, id);
    if (vimThemeEl) vimThemeEl.textContent = id;
    renderThemeGrid();
    // Force reflow then drop the transition-suppression class (mirrors app trick)
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        document.documentElement.classList.remove("theme-switching");
      });
    });
    if (withSound) playSound("toggle");
  }

  var themeGrid = document.getElementById("theme-grid");
  function renderThemeGrid() {
    themeGrid.innerHTML = "";
    THEMES.forEach(function (t) {
      var selected = t.id === currentTheme;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-swatch";
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      btn.innerHTML =
        '<div class="swatch-preview">' +
        '<span style="background:' +
        t.bg +
        '"></span>' +
        '<span style="background:' +
        t.sec +
        '"></span>' +
        '<span style="background:' +
        t.acc +
        '"></span>' +
        '<span style="background:' +
        t.ext +
        '"></span>' +
        "</div>" +
        '<div class="swatch-label"><span>' +
        t.name +
        "</span>" +
        (selected
          ? '<span class="swatch-check" aria-hidden="true">●</span>'
          : "") +
        "</div>";
      btn.addEventListener("click", function () {
        applyTheme(t.id, true);
      });
      themeGrid.appendChild(btn);
    });
  }

  function cycleTheme() {
    var idx = THEMES.findIndex(function (t) {
      return t.id === currentTheme;
    });
    var next = THEMES[(idx + 1) % THEMES.length];
    applyTheme(next.id, true);
  }

  applyTheme(currentTheme, false);

  // ════════════════════════════════════════════════════════════════════
  // QUOTES (31) — ported verbatim from src/lib/startup-display.ts
  // ════════════════════════════════════════════════════════════════════
  var QUOTES = [
    { text: "The best code is no code at all.", author: "Jeff Atwood" },
    {
      text: "Programs must be written for people to read, and only incidentally for machines to execute.",
      author: "Abelson & Sussman",
    },
    { text: "Make it work, make it right, make it fast.", author: "Kent Beck" },
    { text: "Simplicity is the soul of efficiency.", author: "Austin Freeman" },
    {
      text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
      author: "Martin Fowler",
    },
    {
      text: "First, solve the problem. Then, write the code.",
      author: "John Johnson",
    },
    {
      text: "Code is like humor. When you have to explain it, it's bad.",
      author: "Cory House",
    },
    {
      text: "Before software can be reusable it first has to be usable.",
      author: "Ralph Johnson",
    },
    {
      text: "Clean code always looks like it was written by someone who cares.",
      author: "Robert C. Martin",
    },
    {
      text: 'The most dangerous phrase is "we\'ve always done it this way".',
      author: "Grace Hopper",
    },
    {
      text: "Architecture is the decisions you wish you could get right early in a project.",
      author: "Martin Fowler",
    },
    {
      text: "The best error message is the one that never shows up.",
      author: "Thomas Fuchs",
    },
    { text: "It works on my machine.", author: "Every developer, always" },
    { text: "git blame yourself.", author: "The terminal" },
    {
      text: "There are only two hard things in CS: cache invalidation, naming things, and off-by-one errors.",
      author: "Unknown",
    },
    {
      text: "Debugging: being the detective in a crime movie where you're also the murderer.",
      author: "Unknown",
    },
    {
      text: "The code you wrote six months ago was written by an idiot.",
      author: "Unknown",
    },
    { text: "sudo make me a sandwich.", author: "xkcd" },
    {
      text: "I don't always test my code, but when I do, I do it in production.",
      author: "Unknown",
    },
    {
      text: "A QA engineer walks into a coffie shop. Orders 0 cups. Orders 999999 cups. Orders NULL cups. Walks in through the window.",
      author: "Unknown",
    },
    {
      text: "To understand recursion, you must first understand recursion.",
      author: "Unknown",
    },
    { text: "The code review is the product.", author: "diffing" },
    {
      text: "Your abstractions are just someone else's bugs.",
      author: "Unknown",
    },
    {
      text: "Every rewrite is a confession that you didn't understand the problem the first time.",
      author: "Unknown",
    },
    {
      text: "The best PR is no PR — ship it in the design.",
      author: "Unknown",
    },
    { text: "You don't own your code. Your code owns you.", author: "Unknown" },
    {
      text: "A diff is a conversation. What story does yours tell?",
      author: "Unknown",
    },
    {
      text: "The senior engineer's superpower: knowing which shortcuts will haunt you.",
      author: "Unknown",
    },
    {
      text: "Production is the only real test environment.",
      author: "Site Reliability truth",
    },
    { text: "Tech debt is just deferred thinking.", author: "Unknown" },
    { text: "Comments lie. Code never does.", author: "Ron Jeffries" },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Startup typewriter boot animation (spirit/params from startup-display.ts)
  // ════════════════════════════════════════════════════════════════════
  var bootScreen = document.getElementById("boot-screen");
  var quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  var bootLines = [
    { html: "diffing v0.2.1 — starting review server…", cls: "" },
    { html: '▸ binding 127.0.0.1 … <span class="ok">ok</span>', cls: "" },
    { html: '▸ scanning working tree … <span class="ok">ok</span>', cls: "" },
    {
      html: '▸ opening browser review UI … <span class="ok">ok</span>',
      cls: "",
    },
    {
      html:
        '<span class="quote">"' +
        esc(quote.text) +
        '" — ' +
        esc(quote.author) +
        "</span>",
      cls: "",
    },
    { html: '<span class="ready">ready ❯</span>', cls: "" },
  ];

  function renderBootInstant() {
    bootScreen.innerHTML =
      bootLines
        .map(function (l) {
          return l.html;
        })
        .join("\n") + '<span class="boot-cursor" aria-hidden="true"></span>';
  }

  function runBootTypewriter() {
    // Plain-text versions for char-by-char typing; preserve final HTML at line end.
    var tmp = document.createElement("div");
    var plains = bootLines.map(function (l) {
      tmp.innerHTML = l.html;
      return tmp.textContent;
    });
    var done = [];
    var li = 0;
    var ci = 0;
    var cursor = '<span class="boot-cursor" aria-hidden="true"></span>';

    function tick() {
      if (li >= bootLines.length) {
        bootScreen.innerHTML = done.join("\n") + "\n" + cursor;
        return;
      }
      var full = plains[li];
      ci++;
      var typed = full.slice(0, ci);
      var rendered = done.concat([esc(typed)]).join("\n");
      bootScreen.innerHTML = rendered + cursor;
      if (ci >= full.length) {
        // finalize this line with its real (colored) HTML
        done.push(bootLines[li].html);
        li++;
        ci = 0;
        setTimeout(tick, 120);
      } else {
        setTimeout(tick, 16);
      }
    }
    tick();
  }

  if (prefersReduced) {
    renderBootInstant();
  } else {
    runBootTypewriter();
  }

  // ════════════════════════════════════════════════════════════════════
  // SOUND / HAPTIC LAB
  // ════════════════════════════════════════════════════════════════════
  var soundGrid = document.getElementById("sound-grid");
  SOUND_PRESETS.forEach(function (p) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sound-btn";
    btn.innerHTML =
      '<span class="sb-name">' +
      p +
      '</span><span class="sb-caption">' +
      SOUND_CAPTIONS[p] +
      "</span>";
    btn.addEventListener("click", function () {
      // global listener already fires 'click'+selection; add the actual preset + matching haptic
      playSound(p);
      var hapticMap = {
        success: "success",
        error: "error",
        warning: "warning",
        resolve: "success",
        remove: "heavy",
        send: "medium",
        open: "light",
        close: "soft",
      };
      fireHaptic(hapticMap[p] || "selection");
    });
    soundGrid.appendChild(btn);
  });

  var hapticChips = document.getElementById("haptic-chips");
  HAPTIC_PRESETS.forEach(function (p) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "haptic-chip";
    chip.textContent = p;
    chip.addEventListener("click", function () {
      fireHaptic(p);
    });
    hapticChips.appendChild(chip);
  });

  // ════════════════════════════════════════════════════════════════════
  // COPY-TO-CLIPBOARD (hero + command lists)
  // ════════════════════════════════════════════════════════════════════
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) {}
    return Promise.resolve();
  }

  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      copyText(btn.getAttribute("data-copy"));
      playSound("success");
      fireHaptic("success");
      btn.classList.add("copied");
      var hint = btn.querySelector(".copy-hint");
      var orig = hint ? hint.textContent : null;
      if (hint) hint.textContent = "✓ copied";
      setTimeout(function () {
        btn.classList.remove("copied");
        if (hint) hint.textContent = orig;
      }, 1400);
    });
  });

  document.querySelectorAll("[data-scroll-to]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.getAttribute("data-scroll-to"));
      if (el) {
        el.scrollIntoView({
          behavior: prefersReduced ? "auto" : "smooth",
          block: "start",
        });
        playSound("navigate");
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // COMMAND LISTS (install/run/update + skills) — click row to copy
  // ════════════════════════════════════════════════════════════════════
  var CMDS = [
    { c: true, text: "# Install (global)" },
    { c: false, text: "npm install -g diffing" },
    {
      c: true,
      text: "# Review uncommitted changes (opens the web UI on a TTY)",
    },
    { c: false, text: "diffing" },
    { c: true, text: "# Review staged changes" },
    { c: false, text: "diffing --staged" },
    { c: true, text: "# Review the last 3 commits" },
    { c: false, text: "diffing HEAD~3" },
    { c: true, text: "# Compare two branches" },
    { c: false, text: "diffing main..feature" },
    { c: true, text: "# Limit to a path" },
    { c: false, text: "diffing -- src/" },
    { c: true, text: "# Expose to your LAN (default bind is 127.0.0.1)" },
    { c: false, text: "diffing --host 0.0.0.0" },
    {
      c: true,
      text: "# Pick a fixed port (otherwise a random free port is chosen)",
    },
    { c: false, text: "diffing --port 4317" },
    { c: true, text: "# Don't auto-open the browser" },
    { c: false, text: "diffing --no-open" },
    { c: true, text: "# Upgrade to the latest version" },
    { c: false, text: "diffing update" },
  ];
  var SKILLS_CMDS = [{ c: false, text: "npx skills add ahmedragab20/diffing" }];

  function renderCmds(containerId, list) {
    var container = document.getElementById(containerId);
    list.forEach(function (cmd) {
      var row = document.createElement("div");
      row.className = "cmd-row" + (cmd.c ? " comment" : "");
      var textHtml;
      if (cmd.c) {
        textHtml = '<span class="cmd-text">' + esc(cmd.text) + "</span>";
      } else {
        var first = cmd.text.split(" ")[0];
        textHtml =
          '<span class="cmd-text"><span class="cmd-bin">' +
          esc(first) +
          "</span>" +
          esc(cmd.text.slice(first.length)) +
          "</span>";
      }
      row.innerHTML =
        textHtml + (cmd.c ? "" : '<span class="cmd-copy">⧉ copy</span>');
      if (!cmd.c) {
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        var doCopy = function () {
          copyText(cmd.text);
          playSound("success");
          fireHaptic("light");
          row.classList.add("copied");
          var cp = row.querySelector(".cmd-copy");
          if (cp) cp.textContent = "✓ copied";
          setTimeout(function () {
            row.classList.remove("copied");
            if (cp) cp.textContent = "⧉ copy";
          }, 1300);
        };
        row.addEventListener("click", doCopy);
        row.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            doCopy();
          }
        });
      }
      container.appendChild(row);
    });
  }
  renderCmds("cmd-list", CMDS);
  renderCmds("cmd-list-skills", SKILLS_CMDS);

  // ════════════════════════════════════════════════════════════════════
  // CAROUSEL (workspace guide)
  // ════════════════════════════════════════════════════════════════════
  var SLIDES = [
    {
      tag: "① Drop-in for git diff",
      title: "Same revisions, options, pathspecs",
      body: "60+ git-compatible flags across 12 categories. Swap git diff → diffing and review in the browser — no new workflow to learn.",
    },
    {
      tag: "② Two output modes",
      title: "Auto-detected by your terminal",
      body: "TTY launches the local web server; a pipe or redirect prints a standard unified patch to stdout. Force either with --web or --terminal.",
    },
    {
      tag: "③ Inline review",
      title: "Comment right on the diff",
      body: 'Inline comments anchored to +/- lines or whole files, threaded replies, and "Apply suggestion" from a ```suggestion``` block that auto-resolves the comment.',
    },
    {
      tag: "④ Hand off to your agent",
      title: "Send to agent — locally",
      body: "Send a verdict + note; your agent picks up comments, replies inline, applies fixes, and resolves threads over a local HTTP/SSE + MCP server. Nothing leaves 127.0.0.1.",
    },
    {
      tag: "⑤ Plan-first reviews",
      title: "Sign-off before code",
      body: "Submit a markdown plan and block until a human approves, rejects, or requests changes. Verdicts: pending · approved · changes-requested · rejected.",
    },
    {
      tag: "⑥ Local-first & secure",
      title: "No account, no cloud",
      body: "Binds 127.0.0.1 by default, path-traversal protected (403 on escape), no telemetry. Data under ~/.diffing/<repo>-<hash>/; inactive projects auto-pruned after 14 days.",
    },
  ];
  var carTrack = document.getElementById("carousel-track");
  var carDots = document.getElementById("car-dots");
  var carIdx = 0;
  var carTimer = null;
  var carPaused = false;

  SLIDES.forEach(function (s, i) {
    var slide = document.createElement("div");
    slide.className = "slide" + (i === 0 ? " active" : "");
    slide.setAttribute("role", "tabpanel");
    slide.innerHTML =
      '<span class="slide-tag">' +
      esc(s.tag) +
      "</span><h3>" +
      esc(s.title) +
      "</h3><p>" +
      esc(s.body) +
      "</p>";
    carTrack.appendChild(slide);

    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "car-dot" + (i === 0 ? " active" : "");
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", "Slide " + (i + 1) + ": " + s.tag);
    dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
    dot.addEventListener("click", function () {
      goSlide(i);
      feedback("selection", "navigate");
    });
    carDots.appendChild(dot);
  });

  function goSlide(i) {
    carIdx = (i + SLIDES.length) % SLIDES.length;
    var slides = carTrack.querySelectorAll(".slide");
    var dots = carDots.querySelectorAll(".car-dot");
    slides.forEach(function (sl, n) {
      sl.classList.toggle("active", n === carIdx);
    });
    dots.forEach(function (d, n) {
      d.classList.toggle("active", n === carIdx);
      d.setAttribute("aria-selected", n === carIdx ? "true" : "false");
    });
  }
  function startCarTimer() {
    if (prefersReduced) return;
    stopCarTimer();
    carTimer = setInterval(function () {
      if (!carPaused) goSlide(carIdx + 1);
    }, 7000);
  }
  function stopCarTimer() {
    if (carTimer) {
      clearInterval(carTimer);
      carTimer = null;
    }
  }

  document.getElementById("car-prev").addEventListener("click", function () {
    goSlide(carIdx - 1);
    feedback("selection", "navigate");
  });
  document.getElementById("car-next").addEventListener("click", function () {
    goSlide(carIdx + 1);
    feedback("selection", "navigate");
  });
  var carousel = document.getElementById("carousel");
  carousel.addEventListener("mouseenter", function () {
    carPaused = true;
  });
  carousel.addEventListener("mouseleave", function () {
    carPaused = false;
  });
  carousel.addEventListener("focusin", function () {
    carPaused = true;
  });
  carousel.addEventListener("focusout", function () {
    carPaused = false;
  });
  carousel.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") {
      goSlide(carIdx - 1);
      feedback("selection", "navigate");
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      goSlide(carIdx + 1);
      feedback("selection", "navigate");
      e.preventDefault();
    }
  });
  startCarTimer();

  // ════════════════════════════════════════════════════════════════════
  // INTERACTIVE SHELL — accurate command map (§3.5)
  // ════════════════════════════════════════════════════════════════════
  var shell = document.getElementById("shell");
  var shellOut = document.getElementById("shell-output");
  var shellInput = document.getElementById("shell-input");
  var history = [];
  var histPos = -1;

  var HELP_BANNER = [
    "diffing v0.2.1 – Local code review tool for git diffs",
    "",
    "Usage: diffing [<git diff options>] [<revision>...] [-- <path>...]",
    "",
    "Git diff options (12 categories):",
    "  Revision/Range · Diff Algorithm · Whitespace · Context · Word Diff",
    "  Moved/Copied · Output Format · Filtering · Output Control · Prefixes",
    "  Submodule · Misc   (60+ flags total, passed straight through to git)",
    "",
    "Server options:",
    "  --port <port>   bind a fixed port (default: random free port)",
    "  --host <host>   bind address (default: 127.0.0.1)",
    "  --no-open       do not auto-open the browser",
    "  --web / --terminal   force the web UI / stdout patch mode",
    "",
    "Examples:",
    "  diffing                 review uncommitted changes in the browser",
    "  diffing --staged        review staged changes",
    "  diffing HEAD~3          review the last 3 commits",
    "  diffing main..feature   compare two branches",
    "  diffing -- src/         limit to a path",
  ];

  // command -> array of {text, cls} lines (or function returning that)
  var COMMANDS = {
    diffing: [
      {
        text: "Auto-detects mode. On a TTY this starts the local web server (binds 127.0.0.1 on a random free",
        cls: "out",
      },
      {
        text: "port) and opens your browser to review uncommitted changes. Piped/redirected, it prints a",
        cls: "out",
      },
      { text: "unified patch to stdout.", cls: "out" },
    ],
    "diffing --help": HELP_BANNER.map(function (l) {
      return {
        text: l,
        cls: l.indexOf("diffing v0.2.1") === 0 ? "accent" : "out",
      };
    }),
    "diffing -h": null, // alias, set below
    "diffing --version": [{ text: "diffing v0.2.1", cls: "accent" }],
    "diffing -v": null,
    "diffing --staged": [
      { text: "Reviews staged changes (git diff --staged).", cls: "out" },
    ],
    "diffing HEAD~3": [{ text: "Reviews the last 3 commits.", cls: "out" }],
    "diffing main..feature": [
      { text: "Compares the main and feature branches.", cls: "out" },
    ],
    "diffing --host 0.0.0.0": [
      {
        text: "Binds to 0.0.0.0 so other machines on your LAN can open the review.",
        cls: "out",
      },
    ],
    "diffing --terminal": [
      { text: "Forces terminal (stdout patch) mode.", cls: "out" },
    ],
    "diffing --web": [{ text: "Forces web (browser UI) mode.", cls: "out" }],
    "diffing await-review": [
      {
        text: "Long-polls the running server until you send your comments from the browser (default",
        cls: "out",
      },
      {
        text: "timeout 570s). Exit: 0 received · 2 timeout · 3 no server.",
        cls: "out",
      },
    ],
    "diffing reply": [
      {
        text: "Usage: diffing reply <commentId> --body <text> [--model <name>]  — posts an agent reply to a comment.",
        cls: "out",
      },
    ],
    "diffing resolve": [
      {
        text: "Usage: diffing resolve <commentId>  — marks a comment resolved.",
        cls: "out",
      },
    ],
    "diffing comments": [
      {
        text: "Prints all comments as XML (or JSON with --json; --open filters to open comments).",
        cls: "out",
      },
    ],
    "diffing url": [
      {
        text: "http://127.0.0.1:<port>  (the running server's base URL)",
        cls: "accent",
      },
    ],
    "diffing mcp": [
      { text: "Starts the diffing MCP server (stdio). Register:", cls: "out" },
      {
        text: '{"mcpServers":{"diffing":{"command":"diffing","args":["mcp"]}}}',
        cls: "accent",
      },
      {
        text: "Exposes 10 tools: await_review, list_comments, reply_to_comment, resolve_comment, submit_plan,",
        cls: "out",
      },
      {
        text: "await_plan_review, list_plans, get_plan, reply_to_plan_comment, resolve_plan_comment.",
        cls: "out",
      },
    ],
    "diffing plan": [
      {
        text: "Plan-review subcommands: submit <file> [--title T] [--wait] · await · list · show [<id>] ·",
        cls: "out",
      },
      {
        text: "reply <id> --body <text> · resolve <id>. Verdicts: pending, approved, changes-requested, rejected.",
        cls: "out",
      },
    ],
    "diffing plan submit": [
      {
        text: "Usage: diffing plan submit <file> [--title T] [--source S] [--model M] [--id <id>] [--wait] [--timeout N]  — submit a markdown plan for human review (default --timeout 570).",
        cls: "out",
      },
    ],
    "diffing plan await": [
      {
        text: "Blocks until the human decides (default timeout 570s). Exit: 0 decision · 2 timeout.",
        cls: "out",
      },
    ],
    "diffing update": [
      { text: "Checking for updates…", cls: "out" },
      {
        text: "Updating diffing via npm (or pnpm if present): npm install -g diffing@latest",
        cls: "ok",
      },
    ],
    help: [
      { text: "Demoable commands:", cls: "accent" },
      {
        text: "  diffing                 diffing --help            diffing --version",
        cls: "out",
      },
      {
        text: "  diffing --staged        diffing HEAD~3            diffing main..feature",
        cls: "out",
      },
      {
        text: "  diffing --host 0.0.0.0  diffing --web/--terminal  diffing await-review",
        cls: "out",
      },
      {
        text: "  diffing reply           diffing resolve           diffing comments",
        cls: "out",
      },
      {
        text: "  diffing url             diffing mcp               diffing update",
        cls: "out",
      },
      {
        text: "  diffing plan [submit|await]                        clear",
        cls: "out",
      },
    ],
  };
  COMMANDS["diffing -h"] = COMMANDS["diffing --help"];
  COMMANDS["diffing -v"] = COMMANDS["diffing --version"];

  // ordered list for Tab completion (real command surface)
  var COMPLETIONS = [
    "diffing",
    "diffing --help",
    "diffing --version",
    "diffing --staged",
    "diffing HEAD~3",
    "diffing main..feature",
    "diffing -- src/",
    "diffing --host 0.0.0.0",
    "diffing --port 4317",
    "diffing --no-open",
    "diffing --web",
    "diffing --terminal",
    "diffing await-review",
    "diffing reply",
    "diffing resolve",
    "diffing comments",
    "diffing url",
    "diffing mcp",
    "diffing update",
    "diffing plan",
    "diffing plan submit",
    "diffing plan await",
    "diffing plan list",
    "diffing plan show",
    "help",
    "clear",
  ];

  function shellPrint(lines) {
    lines.forEach(function (l) {
      var div = document.createElement("div");
      div.className = "shell-line " + (l.cls || "out");
      div.textContent = l.text;
      shellOut.appendChild(div);
    });
  }
  function shellPrintPrompt(cmd) {
    var div = document.createElement("div");
    div.className = "shell-line cmd";
    div.innerHTML =
      '<span class="shell-prompt">~/repo on <span class="branch"> main</span> ❯</span> ' +
      esc(cmd);
    shellOut.appendChild(div);
  }

  function runShell(raw) {
    var cmd = raw.trim();
    if (cmd === "") {
      shellPrintPrompt("");
      scrollShell();
      return;
    }
    shellPrintPrompt(cmd);
    history.push(cmd);
    histPos = history.length;

    if (cmd === "clear") {
      shellOut.innerHTML = "";
      return;
    }

    // Normalize a couple of common path variants
    var key = cmd;
    if (cmd === "diffing -- src/" || cmd === "diffing -- src") {
      shellPrint([
        {
          text: "Limits the review to the src/ pathspec (passed through to git diff).",
          cls: "out",
        },
      ]);
      scrollShell();
      return;
    }
    if (cmd === "diffing --port 4317" || /^diffing --port \d+$/.test(cmd)) {
      shellPrint([
        {
          text: "Binds the web server to a fixed port (otherwise a random free port is chosen).",
          cls: "out",
        },
      ]);
      scrollShell();
      return;
    }
    if (cmd === "diffing --no-open") {
      shellPrint([
        {
          text: "Starts the server without auto-opening the browser (prints the URL to copy).",
          cls: "out",
        },
      ]);
      scrollShell();
      return;
    }
    if (cmd === "diffing plan list") {
      shellPrint([
        {
          text: "Lists submitted plans with their verdicts (pending/approved/changes-requested/rejected).",
          cls: "out",
        },
      ]);
      scrollShell();
      return;
    }
    if (/^diffing plan show/.test(cmd)) {
      shellPrint([
        {
          text: "Shows a plan (latest if no id), with inline comments and current verdict.",
          cls: "out",
        },
      ]);
      scrollShell();
      return;
    }

    var resp = COMMANDS[key];
    if (resp) {
      shellPrint(resp);
    } else {
      shellPrint([
        {
          text:
            "diffing: '" +
            cmd +
            "' is not a diffing command. Try 'diffing --help'.",
          cls: "err",
        },
      ]);
    }
    scrollShell();
  }
  function scrollShell() {
    shell.scrollTop = shell.scrollHeight;
  }

  shellInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      playSound("navigate");
      runShell(shellInput.value);
      shellInput.value = "";
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      histPos = Math.max(0, histPos - 1);
      shellInput.value = history[histPos] || "";
      moveCaretEnd();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (history.length === 0) return;
      histPos = Math.min(history.length, histPos + 1);
      shellInput.value = history[histPos] || "";
      moveCaretEnd();
    } else if (e.key === "Tab") {
      e.preventDefault();
      var v = shellInput.value;
      var matches = COMPLETIONS.filter(function (c) {
        return c.indexOf(v) === 0 && c !== v;
      });
      if (matches.length === 1) {
        shellInput.value = matches[0];
        playSound("navigate");
      } else if (matches.length > 1) {
        shellPrintPrompt(v);
        shellPrint([{ text: matches.join("    "), cls: "accent" }]);
        // longest common prefix
        var lcp = matches.reduce(function (a, b) {
          var i = 0;
          while (i < a.length && i < b.length && a[i] === b[i]) i++;
          return a.slice(0, i);
        });
        shellInput.value = lcp;
        scrollShell();
      }
    }
  });
  shell.addEventListener("click", function (e) {
    if (e.target === shell || e.target === shellOut) shellInput.focus();
  });

  // ════════════════════════════════════════════════════════════════════
  // LIVE DIFF SHOWCASE
  // ════════════════════════════════════════════════════════════════════
  var diffBoard = document.getElementById("diff-board");
  var diffModeEl = document.getElementById("diff-mode");
  var diffMode = "split";

  // token classes are decorative; content is real-looking code
  var DIFF_FILES = [
    {
      file: "src/cli.ts",
      hunk: "@@ -41,7 +41,9 @@ async function main() {",
      rows: [
        {
          type: "ctx",
          ln: "41",
          code: "  const args = parseArgs(process.argv.slice(2))",
        },
        { type: "ctx", ln: "42", code: "  const isTTY = process.stdout.isTTY" },
        { type: "del", ln: "43", code: "  const port = 4317" },
        {
          type: "add",
          ln: "43",
          code: "  // bind 127.0.0.1 on a random free port unless --port is given",
          suggest: false,
        },
        {
          type: "add",
          ln: "44",
          code: "  const port = args.port ?? await findFreePort()",
        },
        { type: "ctx", ln: "45", code: "  if (isTTY && !args.terminal) {" },
        {
          type: "add",
          ln: "46",
          code: "    await playStartupDisplay()",
          suggest: true,
          suggestion: "    await playStartupDisplay() // 1 of 31 quotes",
        },
        {
          type: "ctx",
          ln: "47",
          code: '    return startServer({ host: args.host ?? "127.0.0.1", port })',
        },
        { type: "ctx", ln: "48", code: "  }" },
      ],
    },
    {
      file: "src/ui/hooks/useHaptics.tsx",
      hunk: "@@ -95,6 +95,7 @@ function synth(ctx, preset) {",
      rows: [
        { type: "ctx", ln: "95", code: "    case 'click':" },
        {
          type: "del",
          ln: "96",
          code: "      note(700, 'sine', 0.16, 0, 0.03)",
        },
        {
          type: "add",
          ln: "96",
          code: "      note(700, 'sine', 0.16, 0, 0.03, 350) // glide down to 350Hz",
        },
        { type: "ctx", ln: "97", code: "      break" },
        { type: "ctx", ln: "98", code: "    case 'success':" },
        {
          type: "add",
          ln: "99",
          code: "      note(523, 'sine', 0.17, 0, 0.10)    // C5",
          suggest: false,
        },
        {
          type: "add",
          ln: "100",
          code: "      note(784, 'sine', 0.17, 0.09, 0.13) // G5",
        },
      ],
    },
  ];

  function renderDiff() {
    diffBoard.innerHTML = "";
    diffModeEl.textContent = diffMode;
    DIFF_FILES.forEach(function (f, fi) {
      var fileEl = document.createElement("div");
      fileEl.className = "diff-file";
      var rowsHtml = f.rows
        .map(function (r, ri) {
          var sign = r.type === "add" ? "+" : r.type === "del" ? "-" : " ";
          return (
            '<div class="diff-row ' +
            r.type +
            '" data-file="' +
            fi +
            '" data-row="' +
            ri +
            '"' +
            (r.type !== "ctx"
              ? ' role="button" tabindex="0" aria-label="Comment on line ' +
                r.ln +
                '"'
              : "") +
            ">" +
            '<span class="ln">' +
            r.ln +
            "</span>" +
            '<span class="gutter">' +
            sign +
            "</span>" +
            '<span class="code">' +
            esc(r.code) +
            "</span>" +
            "</div>"
          );
        })
        .join("");
      fileEl.innerHTML =
        '<div class="diff-file-head"><span class="fname">' +
        esc(f.file) +
        "</span></div>" +
        '<div class="diff-hunk-head">' +
        esc(f.hunk) +
        "</div>" +
        '<div class="diff-rows">' +
        rowsHtml +
        "</div>";
      diffBoard.appendChild(fileEl);
    });
    wireDiffRows();
  }

  function wireDiffRows() {
    diffBoard
      .querySelectorAll(".diff-row.add, .diff-row.del")
      .forEach(function (row) {
        var open = function () {
          openCommentBubble(row);
        };
        row.addEventListener("click", open);
        row.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        });
      });
  }

  function openCommentBubble(row) {
    // Avoid stacking duplicate bubbles
    if (
      row.nextElementSibling &&
      row.nextElementSibling.classList.contains("comment-bubble")
    ) {
      row.nextElementSibling.querySelector("textarea").focus();
      return;
    }
    var fi = +row.getAttribute("data-file");
    var ri = +row.getAttribute("data-row");
    var rowData = DIFF_FILES[fi].rows[ri];

    playSound("open");
    fireHaptic("light");

    var bubble = document.createElement("div");
    bubble.className = "comment-bubble";
    var suggestBtn = rowData.suggest
      ? '<button type="button" class="btn-suggest">⤓ Apply suggestion</button>'
      : "";
    bubble.innerHTML =
      '<textarea placeholder="Leave a comment on this line…" aria-label="Comment text"></textarea>' +
      '<div class="comment-actions">' +
      '<button type="button" class="btn-primary btn-comment">Comment</button>' +
      '<button type="button" class="btn-cancel">Cancel</button>' +
      suggestBtn +
      "</div>";
    row.parentNode.insertBefore(bubble, row.nextSibling);
    var ta = bubble.querySelector("textarea");
    ta.focus();

    bubble.querySelector(".btn-cancel").addEventListener("click", function () {
      playSound("close");
      bubble.remove();
    });
    bubble.querySelector(".btn-comment").addEventListener("click", function () {
      var text = ta.value.trim() || "Looks good — small nit on this line.";
      postComment(bubble, row, text, fi);
    });
    if (rowData.suggest) {
      bubble
        .querySelector(".btn-suggest")
        .addEventListener("click", function () {
          playSound("success");
          fireHaptic("success");
          var node = makeCommentNode(
            "you",
            "Applied suggestion ✓ — comment auto-resolved.",
            false,
            true
          );
          bubble.parentNode.insertBefore(node, bubble.nextSibling);
          bubble.remove();
        });
    }
  }

  function makeCommentNode(author, body, isAgent, resolved) {
    var node = document.createElement("div");
    node.className =
      "comment-node" +
      (isAgent ? " agent" : "") +
      (resolved ? " resolved" : "");
    node.innerHTML =
      '<div class="c-meta"><span class="c-author">' +
      esc(author) +
      "</span>" +
      (resolved ? '<span class="c-badge">resolved</span>' : "") +
      "</div>" +
      '<div class="c-body">' +
      esc(body) +
      "</div>";
    return node;
  }

  var AGENT_MODELS = ["claude-opus-4", "claude-sonnet-4", "claude-haiku-4"];
  function postComment(bubble, row, text, fi) {
    playSound("success");
    fireHaptic("success");
    var fileName = DIFF_FILES[fi].file;
    var node = makeCommentNode("you", text, false, false);
    bubble.parentNode.insertBefore(node, bubble.nextSibling);
    bubble.remove();

    // Scripted agent reply after ~1.2s — demos the SSE handoff
    setTimeout(function () {
      var model = AGENT_MODELS[Math.floor(Math.random() * AGENT_MODELS.length)];
      var replyText = "Good catch — pushed a fix and resolved this thread.";
      var agentNode = makeCommentNode("agent", replyText, true, false);
      // resolve affordance
      var rbtn = document.createElement("div");
      rbtn.className = "comment-actions";
      rbtn.innerHTML =
        '<button type="button" class="btn-resolve">✓ Resolve</button>';
      agentNode.appendChild(rbtn);
      rbtn.querySelector(".btn-resolve").addEventListener("click", function () {
        playSound("resolve");
        fireHaptic("success");
        agentNode.classList.add("resolved");
        var meta = agentNode.querySelector(".c-meta");
        if (!meta.querySelector(".c-badge")) {
          var badge = document.createElement("span");
          badge.className = "c-badge";
          badge.textContent = "resolved";
          meta.appendChild(badge);
        }
        rbtn.remove();
      });
      node.parentNode.insertBefore(agentNode, node.nextSibling);
      showToast("Agent replied", model, fileName, replyText);
    }, 1200);
  }

  renderDiff();

  function toggleDiffMode() {
    diffMode = diffMode === "split" ? "unified" : "split";
    renderDiff();
    playSound("toggle");
  }

  // Send to agent / verdict popover
  var sendBtn = document.getElementById("send-agent-btn");
  var verdictPop = document.getElementById("verdict-popover");
  sendBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var willOpen = verdictPop.hidden;
    verdictPop.hidden = !willOpen;
    if (willOpen) playSound("open");
  });
  verdictPop.querySelectorAll("[data-verdict]").forEach(function (b) {
    b.addEventListener("click", function () {
      var verdict = b.getAttribute("data-verdict");
      verdictPop.hidden = true;
      playSound("send");
      fireHaptic("medium");
      var model = AGENT_MODELS[Math.floor(Math.random() * AGENT_MODELS.length)];
      showToast(
        "Review sent · " + verdict,
        model,
        "src/cli.ts",
        "Agent picked up the review and is working through your comments…"
      );
    });
  });
  document.addEventListener("click", function (e) {
    if (
      !verdictPop.hidden &&
      !verdictPop.contains(e.target) &&
      e.target !== sendBtn &&
      !sendBtn.contains(e.target)
    ) {
      verdictPop.hidden = true;
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // AGENT TOAST
  // ════════════════════════════════════════════════════════════════════
  var toast = document.getElementById("agent-toast");
  var toastTimer = null;
  function showToast(title, model, path, preview) {
    document.getElementById("toast-title").textContent = title;
    document.getElementById("toast-model").textContent = model;
    document.getElementById("toast-path").textContent = path;
    var p = preview.length > 120 ? preview.slice(0, 120) + "…" : preview;
    document.getElementById("toast-preview").textContent = p;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
    }, 8000);
  }
  toast.addEventListener("click", function () {
    toast.hidden = true;
    if (toastTimer) clearTimeout(toastTimer);
  });

  // ════════════════════════════════════════════════════════════════════
  // SHORTCUTS TABLE (authoritative §1.8) — render into page + help overlay
  // ════════════════════════════════════════════════════════════════════
  var SHORTCUTS = [
    { k: ["j", "/", "k"], a: "Scroll down / up (100px)" },
    { k: ["Ctrl+d", "/", "Ctrl+u"], a: "Scroll half-page down / up" },
    { k: ["g", "g"], a: "Jump to top" },
    { k: ["G"], a: "Jump to bottom" },
    { k: ["J", "/", "K"], a: "Next / previous file" },
    { k: ["v"], a: "Toggle file viewed / unviewed" },
    { k: ["m"], a: "Toggle split / unified diff" },
    { k: ["t"], a: "Cycle tab size (2 → 4 → 8)" },
    { k: ["w"], a: "Toggle line wrap" },
    { k: ["n"], a: "Toggle line numbers" },
    { k: ["i"], a: "Cycle diff indicators (classic → bars → none)" },
    { k: ["I"], a: "Cycle inline diff type (word → word-alt → char → none)" },
    { k: ["b"], a: "Toggle sidebar" },
    { k: ["/"], a: "Text search palette" },
    { k: ["s"], a: "Symbol search palette" },
    { k: ["g", "v"], a: "File browser palette" },
    { k: ["g", "t"], a: "Theme picker" },
    {
      k: ["Cmd/Ctrl", "+", "K"],
      a: "Command palette (works inside text fields)",
    },
    { k: ["?"], a: "This shortcuts help" },
  ];
  function renderKeys(tbodySel) {
    var tb = document.querySelector(tbodySel);
    SHORTCUTS.forEach(function (s) {
      var tr = document.createElement("tr");
      var keyHtml = s.k
        .map(function (token) {
          return token === "/" || token === "+"
            ? '<span class="dim">' + token + "</span>"
            : "<kbd>" + esc(token) + "</kbd>";
        })
        .join(" ");
      tr.innerHTML =
        '<td class="kbd-cell">' + keyHtml + "</td><td>" + esc(s.a) + "</td>";
      tb.appendChild(tr);
    });
  }
  renderKeys("#keys-table tbody");
  renderKeys("#help-keys-table tbody");

  // ════════════════════════════════════════════════════════════════════
  // VIM STATUS BAR + KEYBINDINGS (§3.7) — 800ms multi-key buffer
  // ════════════════════════════════════════════════════════════════════
  var vimBar = document.getElementById("vim-bar");
  var vimMode = document.getElementById("vim-mode");
  var vimTab = document.getElementById("vim-tab");
  var tabSizes = [2, 4, 8];
  var tabIdx = 1; // default tab:4

  function isTyping() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }
  function refreshVimMode() {
    var typing = isTyping();
    vimMode.textContent = typing ? "-- INSERT --" : "-- NORMAL --";
    vimBar.classList.toggle("insert", typing);
  }
  document.addEventListener("focusin", refreshVimMode);
  document.addEventListener("focusout", function () {
    setTimeout(refreshVimMode, 0);
  });
  refreshVimMode();

  var helpOverlay = document.getElementById("help-overlay");
  function openHelp() {
    if (helpOverlay.hidden) {
      helpOverlay.hidden = false;
      playSound("open");
      fireHaptic("medium");
      document.getElementById("help-close").focus();
    }
  }
  function closeOverlays() {
    var closed = false;
    if (!helpOverlay.hidden) {
      helpOverlay.hidden = true;
      closed = true;
    }
    if (!verdictPop.hidden) {
      verdictPop.hidden = true;
      closed = true;
    }
    document.querySelectorAll(".comment-bubble").forEach(function (b) {
      b.remove();
      closed = true;
    });
    if (closed) playSound("close");
    return closed;
  }
  document.getElementById("help-close").addEventListener("click", function () {
    helpOverlay.hidden = true;
    playSound("close");
  });
  helpOverlay.addEventListener("click", function (e) {
    if (e.target === helpOverlay) {
      helpOverlay.hidden = true;
      playSound("close");
    }
  });

  // multi-key buffer (800ms)
  var pending = "";
  var pendingTimer = null;
  function clearPending() {
    pending = "";
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }
  function setPending(key) {
    pending = key;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      pending = "";
    }, 800);
  }

  function scrollHalf(dir) {
    var amt = Math.round(window.innerHeight / 2) * dir;
    window.scrollBy({ top: amt, behavior: prefersReduced ? "auto" : "smooth" });
  }
  function cycleTab() {
    tabIdx = (tabIdx + 1) % tabSizes.length;
    vimTab.textContent = "tab:" + tabSizes[tabIdx];
    playSound("toggle");
    fireHaptic("selection");
  }

  document.addEventListener("keydown", function (e) {
    // Cmd/Ctrl+K works even inside fields
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      openHelp();
      clearPending();
      return;
    }
    // Esc closes overlays even while typing (and blurs)
    if (e.key === "Escape") {
      if (closeOverlays()) {
        clearPending();
        return;
      }
      if (isTyping()) {
        document.activeElement.blur();
      }
      clearPending();
      return;
    }

    if (isTyping()) return; // single-key shortcuts disabled while typing

    // Ctrl+d / Ctrl+u half-page
    if (e.ctrlKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      scrollHalf(1);
      return;
    }
    if (e.ctrlKey && (e.key === "u" || e.key === "U")) {
      e.preventDefault();
      scrollHalf(-1);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // multi-key 'g' prefix
    if (pending === "g") {
      clearPending();
      if (e.key === "g") {
        window.scrollTo({
          top: 0,
          behavior: prefersReduced ? "auto" : "smooth",
        });
        return;
      }
      if (e.key === "t") {
        openThemePicker();
        return;
      }
      if (e.key === "v") {
        var dp = document.getElementById("diff-panel");
        if (dp)
          dp.scrollIntoView({
            behavior: prefersReduced ? "auto" : "smooth",
            block: "start",
          });
        playSound("navigate");
        return;
      }
      // fall through if not a known g-combo
    }

    switch (e.key) {
      case "g":
        setPending("g");
        break;
      case "j":
        window.scrollBy({
          top: 100,
          behavior: prefersReduced ? "auto" : "smooth",
        });
        break;
      case "k":
        window.scrollBy({
          top: -100,
          behavior: prefersReduced ? "auto" : "smooth",
        });
        break;
      case "G":
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: prefersReduced ? "auto" : "smooth",
        });
        break;
      case "t":
        cycleTab();
        break;
      case "m":
        toggleDiffMode();
        break;
      case "/":
        e.preventDefault();
        shellInput.focus();
        document
          .getElementById("shell-panel")
          .scrollIntoView({
            behavior: prefersReduced ? "auto" : "smooth",
            block: "center",
          });
        break;
      case "s":
        e.preventDefault();
        document
          .getElementById("shell-panel")
          .scrollIntoView({
            behavior: prefersReduced ? "auto" : "smooth",
            block: "center",
          });
        shellInput.focus();
        playSound("navigate");
        break;
      case "?":
        e.preventDefault();
        openHelp();
        break;
      default:
        break;
    }
  });

  function openThemePicker() {
    playSound("open");
    fireHaptic("medium");
    var grid = document.getElementById("theme-grid");
    grid.scrollIntoView({
      behavior: prefersReduced ? "auto" : "smooth",
      block: "center",
    });
    var first = grid.querySelector(".theme-swatch");
    if (first) first.focus();
  }
})();
