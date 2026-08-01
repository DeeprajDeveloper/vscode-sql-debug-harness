(function () {
  var STORAGE_KEY = "vscode-sql-debug-harness-theme";
  var THEMES = ["dark", "light"];

  function preferredTheme() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (THEMES.indexOf(stored) !== -1) {
      return stored;
    }
    if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  }

  function syncThemeToggle(theme) {
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) {
      return;
    }
    var isLight = theme === "light";
    toggle.setAttribute("aria-pressed", isLight ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      isLight ? "Switch to dark theme" : "Switch to light theme"
    );
    toggle.setAttribute(
      "title",
      isLight ? "Switch to dark theme" : "Switch to light theme"
    );
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    syncThemeToggle(theme);
  }

  function initTheme() {
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) {
      return;
    }
    var theme =
      document.documentElement.getAttribute("data-theme") || preferredTheme();
    if (!document.documentElement.getAttribute("data-theme")) {
      applyTheme(theme);
    } else {
      syncThemeToggle(theme);
    }
    toggle.addEventListener("click", function () {
      var current =
        document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "dark" ? "light" : "dark");
    });
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", function (event) {
        if (localStorage.getItem(STORAGE_KEY)) {
          return;
        }
        applyTheme(event.matches ? "dark" : "light");
      });
  }

  function initMobileToc() {
    var sidebar = document.getElementById("sidebar");
    var tocToggle = document.getElementById("tocToggle");
    var backdrop = document.getElementById("sidebarBackdrop");
    if (!sidebar || !tocToggle) {
      return;
    }

    function setOpen(open) {
      sidebar.classList.toggle("open", open);
      tocToggle.setAttribute("aria-expanded", open ? "true" : "false");
      tocToggle.textContent = open ? "Close" : "Contents";
      if (backdrop) {
        backdrop.classList.toggle("is-visible", open);
        backdrop.hidden = !open;
      }
      document.body.style.overflow = open ? "hidden" : "";
    }

    function close() {
      setOpen(false);
    }

    tocToggle.addEventListener("click", function () {
      setOpen(!sidebar.classList.contains("open"));
    });
    if (backdrop) {
      backdrop.addEventListener("click", close);
    }
    document.querySelectorAll(".navlink, .sidebar-cta, .brand").forEach(function (link) {
      link.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        close();
      }
    });
    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 1025px)").matches) {
        close();
      }
    });
  }

  function initScrollspy() {
    var navlinks = Array.from(
      document.querySelectorAll(".navlink[data-target]")
    );
    if (!navlinks.length) {
      return;
    }
    var sections = navlinks
      .map(function (link) {
        return document.getElementById(link.getAttribute("data-target"));
      })
      .filter(Boolean);
    if (!sections.length) {
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var link = navlinks.find(function (item) {
            return item.getAttribute("data-target") === entry.target.id;
          });
          if (!link) {
            return;
          }
          if (entry.isIntersecting) {
            navlinks.forEach(function (item) {
              item.classList.remove("active");
            });
            link.classList.add("active");
          }
        });
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );

    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  function initPackageVersion() {
    var root = document.getElementById("package-version");
    if (!root) {
      return;
    }
    var valueEl = root.querySelector(".sidebar-version__value");
    if (!valueEl) {
      return;
    }
    fetch("./version.json")
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (data && data.version) {
          valueEl.textContent = "v" + data.version;
        }
      })
      .catch(function () {
        /* keep HTML fallback */
      });
  }

  function initCopySnippets() {
    document.querySelectorAll(".snippet-block").forEach(function (block) {
      var button = block.querySelector(".snippet-block__copy");
      var code = block.querySelector("pre code");
      if (!button || !code) {
        return;
      }

      function copyText() {
        var text = code.textContent || "";
        if (!text) {
          return;
        }
        var done = function () {
          button.textContent = "Copied";
          button.setAttribute("data-copied", "true");
          window.setTimeout(function () {
            button.textContent = "Copy";
            button.removeAttribute("data-copied");
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {
            fallbackCopy(text, done);
          });
        } else {
          fallbackCopy(text, done);
        }
      }

      function fallbackCopy(text, onSuccess) {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        try {
          if (document.execCommand("copy")) {
            onSuccess();
          }
        } finally {
          document.body.removeChild(area);
        }
      }

      button.addEventListener("click", function (event) {
        event.preventDefault();
        copyText();
      });
    });
  }

  function initDemo() {
    var demoCodeEl = document.getElementById("demoCode");
    var demoFootnote = document.getElementById("demoFootnote");
    var tabs = document.querySelectorAll(".demo-tab");
    var scenarioBtns = document.querySelectorAll(".demo-scenario");
    if (!demoCodeEl || !tabs.length) {
      return;
    }

    var scenarios = {
      dml: {
        original:
          '<span class="kw">CREATE PROCEDURE</span> dbo.usp_SimpleDml\n' +
          "    @Id INT,\n" +
          "    @Name NVARCHAR(100)\n" +
          "<span class=\"kw\">AS</span>\n" +
          "<span class=\"kw\">BEGIN</span>\n" +
          '    <span class="risk-tok">INSERT INTO</span> dbo.Items (Id, Name)\n' +
          "    <span class=\"kw\">VALUES</span> (@Id, @Name);\n" +
          '    <span class="risk-tok">UPDATE</span> dbo.Items\n' +
          "    <span class=\"kw\">SET</span> Name = @Name <span class=\"kw\">WHERE</span> Id = @Id;\n" +
          "<span class=\"kw\">END</span>",
        debug:
          '<span class="com">-- [DBG] Harness: was CREATE PROCEDURE dbo.usp_SimpleDml</span>\n' +
          '<span class="kw">DECLARE</span> @Id INT = <span class="kw">NULL</span>,  <span class="com">-- TODO: set test value</span>\n' +
          "        @Name NVARCHAR(100) = <span class=\"kw\">NULL</span>;  <span class=\"com\">-- TODO: set test value</span>\n" +
          '    <span class="com">-- [DBG-PREVIEW] Would have executed:</span>\n' +
          '    <span class="safe-tok">SELECT</span> <span class="str">N\'INSERT to table dbo.Items\'</span> <span class="kw">AS</span> [DBG_Action],\n' +
          "           @Id <span class=\"kw\">AS</span> [@Id], @Name <span class=\"kw\">AS</span> [@Name];\n" +
          '    <span class="com">-- [DBG-PREVIEW] Would have executed:</span>\n' +
          '    <span class="safe-tok">SELECT</span> <span class="str">N\'UPDATE to table dbo.Items\'</span> <span class="kw">AS</span> [DBG_Action],\n' +
          "           @Name <span class=\"kw\">AS</span> [@Name]\n" +
          "    <span class=\"kw\">FROM</span> dbo.Items <span class=\"kw\">WHERE</span> Id = @Id;",
        originalNote:
          '<span class="risk-tag">● live write</span> — running this mutates real rows in <code class="inline">dbo.Items</code>.',
        debugNote:
          '<span class="safe-tag">● read-only</span> — durable-table DML becomes SELECT previews; procedure AS BEGIN/END is stripped.',
      },
      temp: {
        original:
          '<span class="kw">CREATE PROCEDURE</span> dbo.usp_Temp\n' +
          "    @Id INT\n" +
          "<span class=\"kw\">AS</span>\n" +
          "<span class=\"kw\">BEGIN</span>\n" +
          "    <span class=\"kw\">CREATE TABLE</span> #Temp (Id INT);\n" +
          '    <span class="risk-tok">INSERT INTO</span> #Temp (Id) <span class="kw">VALUES</span> (@Id);\n' +
          '    <span class="risk-tok">INSERT INTO</span> dbo.Items (Id) <span class="kw">VALUES</span> (@Id);\n' +
          "<span class=\"kw\">END</span>",
        debug:
          '<span class="com">-- [DBG] Harness: was CREATE PROCEDURE dbo.usp_Temp</span>\n' +
          '<span class="kw">DECLARE</span> @Id INT = <span class="kw">NULL</span>;  <span class="com">-- TODO: set test value</span>\n' +
          "    <span class=\"kw\">CREATE TABLE</span> #Temp (Id INT);\n" +
          '    <span class="safe-tok">INSERT INTO</span> #Temp (Id) <span class="kw">VALUES</span> (@Id);\n' +
          '    <span class="com">-- [DBG-PREVIEW] Would have executed:</span>\n' +
          '    <span class="safe-tok">SELECT</span> <span class="str">N\'INSERT to table dbo.Items\'</span> <span class="kw">AS</span> [DBG_Action],\n' +
          "           @Id <span class=\"kw\">AS</span> [@Id];",
        originalNote:
          '<span class="risk-tag">● mixed</span> — #Temp is session-scoped; dbo.Items is a durable write.',
        debugNote:
          '<span class="safe-tag">● selective</span> — #Temp INSERT stays live; only dbo.Items is previewed.',
      },
      ifelse: {
        original:
          '<span class="kw">CREATE PROCEDURE</span> dbo.usp_IfElse\n' +
          "    @Var1 INT\n" +
          "<span class=\"kw\">AS</span>\n" +
          "<span class=\"kw\">BEGIN</span>\n" +
          "    <span class=\"kw\">DECLARE</span> @Var2 INT;\n" +
          "    <span class=\"kw\">IF</span> @Var1 &gt;= 0\n" +
          "      <span class=\"kw\">SET</span> @Var2 = 1\n" +
          "    <span class=\"kw\">ELSE</span>\n" +
          "      <span class=\"kw\">SET</span> @Var2 = 0\n" +
          "<span class=\"kw\">END</span>",
        debug:
          '<span class="com">-- [DBG] Harness: was CREATE PROCEDURE dbo.usp_IfElse</span>\n' +
          '<span class="kw">DECLARE</span> @Var1 INT = <span class="kw">NULL</span>;  <span class="com">-- TODO: set test value</span>\n' +
          "    <span class=\"kw\">DECLARE</span> @Var2 INT;\n" +
          "    <span class=\"kw\">IF</span> @Var1 &gt;= 0\n" +
          "      <span class=\"kw\">BEGIN</span>\n" +
          "          <span class=\"kw\">SET</span> @Var2 = 1\n" +
          "          <span class=\"safe-tok\">SELECT</span> <span class=\"str\">'DBG'</span> [NOTES], @Var2 [Var2];\n" +
          "      <span class=\"kw\">END</span>\n" +
          "    <span class=\"kw\">ELSE</span>\n" +
          "      <span class=\"kw\">BEGIN</span>\n" +
          "          <span class=\"kw\">SET</span> @Var2 = 0\n" +
          "          <span class=\"safe-tok\">SELECT</span> <span class=\"str\">'DBG'</span> [NOTES], @Var2 [Var2];\n" +
          "      <span class=\"kw\">END</span>",
        originalNote:
          '<span class="risk-tag">● bare IF/ELSE</span> — each branch is a single SET with no BEGIN/END.',
        debugNote:
          '<span class="safe-tag">● wrapped</span> — harness adds BEGIN/END so the SELECT trace stays inside each branch.',
      },
      traces: {
        original:
          '<span class="kw">CREATE PROCEDURE</span> dbo.usp_Trace\n' +
          "<span class=\"kw\">AS</span>\n" +
          "<span class=\"kw\">BEGIN</span>\n" +
          "    <span class=\"kw\">SET</span> @A = 1;\n" +
          "    <span class=\"kw\">SELECT</span> @B = 2, @C = 3;\n" +
          "<span class=\"kw\">END</span>",
        debug:
          '<span class="com">-- Default spDebug.traceStyle = select</span>\n' +
          "    <span class=\"kw\">SET</span> @A = 1;\n" +
          "    <span class=\"safe-tok\">SELECT</span> <span class=\"str\">'DBG'</span> [NOTES], @A [A];\n" +
          "    <span class=\"kw\">SELECT</span> @B = 2, @C = 3;\n" +
          "    <span class=\"safe-tok\">SELECT</span> <span class=\"str\">'DBG'</span> [NOTES], @B [B], @C [C];\n\n" +
          '<span class="com">-- With printCombined:</span>\n' +
          "    <span class=\"safe-tok\">PRINT CONCAT</span>(<span class=\"str\">N'[DBG] @B = '</span>, <span class=\"kw\">CAST</span>(@B <span class=\"kw\">AS</span> NVARCHAR(4000)),\n" +
          "                   <span class=\"str\">N'; @C = '</span>, <span class=\"kw\">CAST</span>(@C <span class=\"kw\">AS</span> NVARCHAR(4000)));",
        originalNote:
          '<span class="risk-tag">● assignments</span> — SET and multi-variable SELECT @assign with no traces yet.',
        debugNote:
          '<span class="safe-tag">● traced</span> — default SELECT traces; printCombined folds @B/@C into one PRINT.',
      },
    };

    var currentScenario = "dml";
    var currentState = "original";

    function render() {
      var scenario = scenarios[currentScenario] || scenarios.dml;
      demoCodeEl.innerHTML =
        currentState === "original" ? scenario.original : scenario.debug;
      if (demoFootnote) {
        demoFootnote.innerHTML =
          currentState === "original"
            ? scenario.originalNote
            : scenario.debugNote;
      }
      tabs.forEach(function (tab) {
        tab.classList.toggle(
          "is-active",
          tab.getAttribute("data-state") === currentState
        );
      });
      scenarioBtns.forEach(function (btn) {
        btn.classList.toggle(
          "is-active",
          btn.getAttribute("data-scenario") === currentScenario
        );
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        currentState = tab.getAttribute("data-state") || "original";
        render();
      });
    });

    scenarioBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        currentScenario = btn.getAttribute("data-scenario") || "dml";
        render();
      });
    });

    render();
  }

  function boot() {
    initTheme();
    initMobileToc();
    initScrollspy();
    initPackageVersion();
    initCopySnippets();
    initDemo();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
