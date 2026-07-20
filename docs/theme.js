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
    if (!demoCodeEl || !tabs.length) {
      return;
    }

    var originalCode =
      '<span class="kw">CREATE PROCEDURE</span> dbo.usp_SimpleDml\n' +
      '    <span class="com">@Id INT,</span>\n' +
      '    <span class="com">@Name NVARCHAR(100)</span>\n' +
      '<span class="kw">AS</span>\n' +
      '<span class="kw">BEGIN</span>\n' +
      '    <span class="risk-tok">INSERT INTO</span> dbo.Items (Id, Name)\n' +
      "    <span class=\"kw\">VALUES</span> (@Id, @Name);\n" +
      '    <span class="risk-tok">UPDATE</span> dbo.Items\n' +
      '    <span class="kw">SET</span> Name = @Name <span class="kw">WHERE</span> Id = @Id;\n' +
      '<span class="kw">END</span>';

    var debugCode =
      '<span class="com">-- [DBG] Harness: was CREATE PROCEDURE dbo.usp_SimpleDml</span>\n' +
      '<span class="kw">DECLARE</span> @Id INT = <span class="kw">NULL</span>;  <span class="com">-- TODO: set test value</span>\n' +
      '<span class="kw">DECLARE</span> @Name NVARCHAR(100) = <span class="kw">NULL</span>;\n' +
      '<span class="kw">BEGIN</span>\n' +
      '    <span class="com">-- [DBG-PREVIEW] Would have executed:</span>\n' +
      '    <span class="safe-tok">SELECT</span> <span class="str">N\'INSERT to table dbo.Items\'</span> <span class="kw">AS</span> [DBG_Action],\n' +
      "           @Id <span class=\"kw\">AS</span> [@Id], @Name <span class=\"kw\">AS</span> [@Name];\n" +
      '    <span class="com">-- [DBG-PREVIEW] Would have executed:</span>\n' +
      '    <span class="safe-tok">SELECT</span> <span class="str">N\'UPDATE to table dbo.Items\'</span> <span class="kw">AS</span> [DBG_Action],\n' +
      "           @Name <span class=\"kw\">AS</span> [@Name]\n" +
      '    <span class="kw">FROM</span> dbo.Items <span class="kw">WHERE</span> Id = @Id;\n' +
      '<span class="kw">END</span>';

    function setDemoState(state) {
      demoCodeEl.innerHTML = state === "original" ? originalCode : debugCode;
      if (demoFootnote) {
        demoFootnote.innerHTML =
          state === "original"
            ? '<span class="risk-tag">● live write</span> — running this mutates real rows in <code class="inline">dbo.Items</code>.'
            : '<span class="safe-tag">● read-only</span> — running this changes nothing; it only shows what would happen.';
      }
      tabs.forEach(function (tab) {
        tab.classList.toggle(
          "is-active",
          tab.getAttribute("data-state") === state
        );
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        setDemoState(tab.getAttribute("data-state"));
      });
    });
    setDemoState("original");
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
