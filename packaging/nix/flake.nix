{
  # Orden for Nix, both channels out of one file: the release, taken from its
  # `.deb`, and the app compiled from the sources this file arrives beside.
  #
  # One file, the same bytes on every branch, on purpose. The release flake belongs
  # on main and the source build on unstable, and work flows unstable -> pull
  # request -> main, so while this path held two different files every release pull
  # request either conflicted here or quietly carried the source flake onto main and
  # broke `nix profile install github:lxorb/orden?dir=packaging/nix` for everyone
  # already on it. Nothing below asks which branch it is on: the release outputs are
  # pinned to a published release, and the source output compiles whatever tree this
  # file sits in.
  #
  # `packages.default` and `packages.orden` take the program out of the release's
  # .deb and run it on nixpkgs' own WebKitGTK, GTK and GStreamer, the way the AUR
  # package runs it on Arch's.
  #
  # Not the AppImage, which this flake wrapped up to 0.13. Its own libwayland-client
  # does not match NixOS' Mesa and libglvnd, so WebKit's web process died with
  # "Could not create default EGL display: EGL_BAD_PARAMETER"; its start script
  # forces GTK onto X11 even in a Wayland session; and its GStreamer 1.20 refuses
  # nixpkgs' plugins. The .deb is the bare program, so everything it links is
  # nixpkgs', the same version as everything else on the system: native Wayland,
  # the graphics driver NixOS provides, GStreamer with its plugins, and a fraction
  # of the size.
  #
  # This is not the nixpkgs package - it is a flake anyone can install from
  # directly, without waiting on a nixpkgs review:
  #
  #   nix run github:lxorb/orden?dir=packaging/nix
  #   nix profile install github:lxorb/orden?dir=packaging/nix
  #
  # `packages.orden-unstable` compiles the sources instead, under its own command,
  # desktop entry and icons, so it installs beside the release rather than over it:
  #
  #   nix profile install github:lxorb/orden/unstable?dir=packaging/nix#orden-unstable
  #
  # Two channels and no third. There is no branch carrying a flake pinned to the
  # `edge` pre-release's binaries any more; whoever wants the edge on Nix compiles
  # the branch, which is the one place Nix differs from the other package managers.
  #
  # On NixOS, as an input of the system's flake:
  #
  #   inputs.orden.url = "github:lxorb/orden?dir=packaging/nix";
  #   environment.systemPackages = [ inputs.orden.packages.${pkgs.system}.default ];
  #
  # or through `overlays.default`, which builds them out of the system's own nixpkgs.
  description = "Orden, a markdown editor with realtime inline preview";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # Which release the binary outputs install, moved by
      # .github/workflows/packaging-bump.yml after every one. `tag` is the release
      # the .debs are attached to and `asset` is what they are called there.
      #
      # scripts/bump-packaging.mjs rewrites these four by regex, anchored inside
      # this attrset so that none of its patterns can wander onto the source build's
      # own names below. Keep a `}` out of the comments in here, which is where that
      # anchor ends.
      release = {
        pname = "orden";
        version = "0.15.0";
        tag = "v0.15.0";
        asset = "Orden";
      };

      # One .deb per architecture.
      debs = {
        x86_64-linux = {
          suffix = "x64";
          hash = "sha256-w9xSUsYsFERRwkhKKfBfVwdi/z/HKDQM2j/S3t0nREE=";
        };
        aarch64-linux = {
          suffix = "arm64";
          hash = "sha256-+idhQ+j+HWP42kJ7jlyO1GCd1H0z/DMGdwM0sph8NgE=";
        };
      };

      # The source build's own names, never touched by a release bump.
      fromSource = {
        pname = "orden-unstable";
        # A prerelease version makes a source-built Nix install follow the unstable
        # updater stream by default. Stable and edge release builds have a higher
        # semantic version than this local source build.
        version = "0.0.0-unstable";
      };

      inherit (release) pname version;
      edge = pname != "orden";
      systems = builtins.attrNames debs;
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # The workspace this file sits in, when there is one to see. A flake reference
      # that names the repository and points into it - `github:lxorb/orden?dir=packaging/nix`,
      # or a git checkout - copies the whole repository into the store, so
      # `sourceInfo` is the workspace root and `self.outPath` is this directory
      # inside it. That is the tree the source build compiles, the one that was
      # evaluated: no second clone over the network, and a dirty checkout builds what
      # it actually says. It replaces a `builtins.fetchGit` of `self.rev`, which was
      # here because this file's own outPath holds only packaging/nix - true, but the
      # repository is already in the store one directory up, and fetching it again by
      # revision asked GitHub for the pushed commit rather than building the tree in
      # hand.
      #
      # `path:packaging/nix` copies this directory alone, and then there is no
      # workspace next to it at all. That must not take the release outputs down with
      # it, so it is a question asked here and answered in mkSource rather than an
      # evaluation error.
      workspace = self.sourceInfo.outPath;
      haveSources = builtins.pathExists "${workspace}/apps/desktop/src-tauri/Cargo.lock";

      # WebKitGTK plays audio and video through GStreamer, and these are the only
      # plugins either build is let to load.
      gstPluginsFor =
        pkgs: with pkgs.gst_all_1; [
          gstreamer
          gst-plugins-base
          gst-plugins-good
          gst-plugins-bad
          gst-libav
        ];

      # Everything both builds link against. The release build patches the .deb's
      # program onto these; the source build compiles against them.
      runtimeInputsFor =
        pkgs:
        (with pkgs; [
          webkitgtk_4_1
          gtk3
          libsoup_3
          glib
          glib-networking
          cairo
          pango
          gdk-pixbuf
          dbus
          openssl
          xdotool
          stdenv.cc.cc.lib
        ])
        ++ gstPluginsFor pkgs;

      # Built out of whichever nixpkgs it is handed: this flake's own for
      # `packages`, the system's for `overlays.default`. Nothing is compiled: the
      # .deb is unpacked, its program pointed at nixpkgs' libraries, and wrapped
      # in a shell script.
      mkRelease =
        pkgs:
        let
          inherit (debs.${pkgs.stdenv.hostPlatform.system}) suffix hash;
          gstPlugins = gstPluginsFor pkgs;
        in
        pkgs.stdenv.mkDerivation {
          inherit pname version;

          src = pkgs.fetchurl {
            url = "https://github.com/lxorb/orden/releases/download/${release.tag}/${release.asset}-${version}-linux-${suffix}.deb";
            inherit hash;
          };

          nativeBuildInputs = with pkgs; [
            dpkg
            autoPatchelfHook
            wrapGAppsHook3
            makeShellWrapper
          ];

          buildInputs = runtimeInputsFor pkgs;

          dontConfigure = true;
          dontBuild = true;

          # The program keeps the name every install of it has had, nib, out of
          # $PATH; the command is the package's name, and the stable one keeps
          # `nib` beside it. Tauri's own desktop entry is replaced with the one
          # beside this file, and its 256x256 icon, which it files under a scale-2
          # directory, goes where a theme looks for it. Every file the profile
          # gets is named after the package, so stable and edge never collide.
          installPhase = ''
            runHook preInstall
            install -Dm755 usr/bin/nib $out/libexec/${pname}/nib
            install -d $out/share/applications
            substitute ${./orden.desktop} $out/share/applications/${pname}.desktop \
              --replace-fail 'Name=Orden' 'Name=${if edge then "Orden Edge" else "Orden"}' \
              --replace-fail 'Exec=orden' 'Exec=${pname}' \
              --replace-fail 'Icon=orden' 'Icon=${pname}' \
              --replace-fail 'StartupWMClass=orden' 'StartupWMClass=${pname}'
            for size in 32 128; do
              install -Dm644 usr/share/icons/hicolor/"$size"x"$size"/apps/nib.png \
                $out/share/icons/hicolor/"$size"x"$size"/apps/${pname}.png
            done
            install -Dm644 usr/share/icons/hicolor/256x256@2/apps/nib.png \
              $out/share/icons/hicolor/256x256/apps/${pname}.png
            runHook postInstall
          '';

          # The wrapper is a shell script rather than wrapGAppsHook3's own, which
          # would be compiled, and for the one thing a binary wrapper cannot do:
          # WebKitGTK's DMA-BUF renderer is what leaves a blank window on NVIDIA's
          # own driver, so there, and only there, it is turned off - unless the
          # user has set it either way. Mesa (Intel, AMD) keeps it. GTK names the
          # window after the command it was started as, which is what the desktop
          # entry's StartupWMClass says. Links and attachments open with xdg-open.
          #
          # GStreamer is shut in with its own plugins: a plugin path the session
          # carries (a NixOS profile's lib/, with every Qt and KDE library in it)
          # is not searched, and the registry it keeps is this package's alone, so
          # the web process never tries to load a stranger's .so.
          #
          # pandoc is deliberately not here: it is only needed for importing and
          # exporting DOCX and friends, Orden hides that when it is missing, and
          # anyone who wants it can add it to their own profile.
          dontWrapGApps = true;
          postFixup = ''
            makeShellWrapper $out/libexec/${pname}/nib $out/bin/${pname} \
              "''${gappsWrapperArgs[@]}" \
              --inherit-argv0 \
              --suffix PATH : ${pkgs.lib.makeBinPath [ pkgs.xdg-utils ]} \
              --set GST_PLUGIN_SYSTEM_PATH_1_0 ${pkgs.lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" gstPlugins} \
              --unset GST_PLUGIN_PATH \
              --unset GST_PLUGIN_PATH_1_0 \
              --run 'export GST_REGISTRY_1_0="''${XDG_CACHE_HOME:-$HOME/.cache}/${pname}/gstreamer-registry-${pkgs.stdenv.hostPlatform.system}.bin"' \
              --run 'if [ -z "''${WEBKIT_DISABLE_DMABUF_RENDERER+set}" ] && [ -e /proc/driver/nvidia/version ]; then export WEBKIT_DISABLE_DMABUF_RENDERER=1; fi'
          ''
          + pkgs.lib.optionalString (!edge) ''
            ln -s orden $out/bin/nib
          '';

          meta = {
            description = "Markdown editor with realtime inline preview${pkgs.lib.optionalString edge ", built from main"}";
            homepage = "https://orden.so";
            downloadPage = "https://github.com/lxorb/orden/releases";
            changelog = "https://github.com/lxorb/orden/releases/tag/${release.tag}";
            license = pkgs.lib.licenses.agpl3Only;
            mainProgram = pname;
            platforms = systems;
            sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
          };
        };

      # The same app compiled out of the workspace beside this flake, with its own
      # command, desktop entry, icons, wrapper and GStreamer registry, so it sits in
      # a profile next to the release instead of over it.
      #
      # THE DEPENDENCY HASHES. A source build of this app needs its Cargo and pnpm
      # dependencies fetched in a fixed-output derivation, and a fixed-output hash
      # moves with the lockfile under it. Since this file is now the same on main as
      # on unstable, `nix flake check` on main evaluates this output too, and a hash
      # nobody can keep current must not be able to break it. Two halves, two
      # answers:
      #
      # Cargo: no hash at all. `cargoLock.lockFile` vendors straight out of
      # apps/desktop/src-tauri/Cargo.lock, which is in the tree being built, so there
      # is nothing to keep current and nothing to resolve. The `cargoHash =
      # lib.fakeHash` that stood here was dead either way: nixpkgs uses
      # `importCargoLock` and ignores cargoHash whenever cargoLock is set (see
      # pkgs/build-support/rust/build-rust-package/default.nix), which is why the
      # cargo half of nix.yml's `resolve_source_hashes` loop never had a hash
      # mismatch to catch.
      #
      # pnpm: one real hash, below. It is the pnpm store for pnpm-lock.yaml, and it
      # is the same on both architectures by construction - the fetcher runs
      # `pnpm install --force`, which takes every platform's optional dependencies,
      # so one hash covers x86_64 and aarch64. A real hash means `nix profile
      # install ...#orden-unstable` works for somebody who is not CI, which a
      # placeholder never did. It does go stale when pnpm-lock.yaml moves, and then
      # the *build* fails loudly with the hash it wanted; nix.yml's
      # `resolve_source_hashes` fills it in a runner's copy to validate a build
      # before it is committed here.
      #
      # Neither `nix flake check` nor `nix eval` touches either one: check builds
      # `checks` and only evaluates `packages`, so a stale pnpm hash can never take
      # down the release outputs or the check on main. That is the whole reason this
      # output is safe to carry on a branch whose lockfiles it may not match.
      mkSource =
        pkgs:
        let
          lib = pkgs.lib;
          inherit (fromSource) pname version;
          gstPlugins = gstPluginsFor pkgs;
        in
        if !haveSources then
          # Reached only through a flake reference that copied this directory
          # without the repository around it. The output stays, so that every branch
          # and every reference offers the same attributes, and says what is missing
          # when somebody asks for it to be built.
          pkgs.stdenvNoCC.mkDerivation {
            inherit pname version;
            buildCommand = ''
              echo "${pname} compiles the repository's own sources, and this flake was" >&2
              echo "fetched without them: packaging/nix was copied on its own." >&2
              echo "Name the repository instead, so Nix fetches the workspace with it:" >&2
              echo "  nix build 'github:lxorb/orden/unstable?dir=packaging/nix#${pname}'" >&2
              echo "  nix build '.?dir=packaging/nix#${pname}'   # from a checkout" >&2
              exit 1
            '';
            meta = {
              description = "Orden compiled from the sources beside this flake";
              homepage = "https://orden.so";
              license = lib.licenses.agpl3Only;
              mainProgram = pname;
              platforms = systems;
            };
          }
        else
          pkgs.rustPlatform.buildRustPackage {
            inherit pname version;
            TAURI_CONFIG = builtins.toJSON { inherit version; };
            src = workspace;
            cargoRoot = "apps/desktop/src-tauri";
            cargoLock.lockFile = "${workspace}/apps/desktop/src-tauri/Cargo.lock";

            nativeBuildInputs = with pkgs; [
              pkg-config
              nodejs_24
              pnpm_10
              pnpmConfigHook
              wrapGAppsHook3
              makeWrapper
            ];

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit pname version;
              src = workspace;
              pnpm = pkgs.pnpm_10;
              fetcherVersion = 4;
              hash = "sha256-LUz2LBZRHXa3eToF5qyaLxjza4350N75S1JF4kJYFNQ=";
            };

            buildInputs = runtimeInputsFor pkgs;

            preBuild = ''
              pnpm --filter @nib/desktop build
            '';

            # Everything the profile gets is named after this package, so it never
            # collides with the release's files: the command, the desktop entry
            # (Tauri's own is replaced with the one beside this file, with the
            # pname substituted into it) and the icons, including the 256x256 one
            # Tauri files under a scale-2 name.
            postInstall = ''
              install -Dm755 $out/bin/nib $out/libexec/${pname}/nib
              rm $out/bin/nib
              install -Dm644 ${./orden.desktop} $out/share/applications/${pname}.desktop
              substitute ${./orden.desktop} $out/share/applications/${pname}.desktop \
                --replace-fail 'Name=Orden' 'Name=Orden Unstable' \
                --replace-fail 'Exec=orden' 'Exec=${pname}' \
                --replace-fail 'Icon=orden' 'Icon=${pname}' \
                --replace-fail 'StartupWMClass=orden' 'StartupWMClass=${pname}'
              for size in 32 128; do
                install -Dm644 ${workspace}/apps/desktop/src-tauri/icons/"$size"x"$size".png \
                  $out/share/icons/hicolor/"$size"x"$size"/apps/${pname}.png
              done
              install -Dm644 ${workspace}/apps/desktop/src-tauri/icons/128x128@2x.png \
                $out/share/icons/hicolor/256x256/apps/${pname}.png
            '';

            # The same environment the release build's wrapper sets, for the same
            # reasons: xdg-open on $PATH, GStreamer shut in with its own plugins and
            # with a registry of its own - under this package's name, so the two
            # installs never share one - and WebKitGTK's DMA-BUF renderer turned off
            # on NVIDIA's driver alone, where it leaves a blank window, unless the
            # user has set it either way.
            dontWrapGApps = true;
            postFixup = ''
              wrapProgram $out/libexec/${pname}/nib $out/bin/${pname} \
                --inherit-argv0 \
                ''${gappsWrapperArgs[@]} \
                --prefix PATH : ${lib.makeBinPath [ pkgs.xdg-utils ]} \
                --set GST_PLUGIN_SYSTEM_PATH_1_0 ${lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" gstPlugins} \
                --unset GST_PLUGIN_PATH \
                --unset GST_PLUGIN_PATH_1_0 \
                --run 'if [ -z "''${WEBKIT_DISABLE_DMABUF_RENDERER+set}" ] && [ -e /proc/driver/nvidia/version ]; then export WEBKIT_DISABLE_DMABUF_RENDERER=1; fi' \
                --run 'export GST_REGISTRY_1_0="''${XDG_CACHE_HOME:-$HOME/.cache}/${pname}/gstreamer-registry-${pkgs.stdenv.hostPlatform.system}.bin"'
            '';

            meta = {
              description = "Orden compiled from the sources beside this flake";
              homepage = "https://orden.so";
              downloadPage = "https://github.com/lxorb/orden/tree/unstable/packaging/nix";
              license = lib.licenses.agpl3Only;
              mainProgram = pname;
              platforms = systems;
              sourceProvenance = [ lib.sourceTypes.fromSource ];
            };
          };
    in
    {
      packages = forEach (
        pkgs:
        let
          orden = mkRelease pkgs;
        in
        {
          ${pname} = orden;
          default = orden;
          ${fromSource.pname} = mkSource pkgs;
        }
        # What the package was called before 0.15, for a profile that names it.
        // pkgs.lib.optionalAttrs (!edge) { nib = orden; }
      );

      overlays.default = final: _prev: {
        ${pname} = mkRelease final;
        ${fromSource.pname} = mkSource final;
      };

      # Home Manager, as `programs.orden`:
      #
      #   inputs.orden.url = "github:lxorb/orden?dir=packaging/nix";
      #   imports = [ inputs.orden.homeManagerModules.default ];
      #   programs.orden.enable = true;
      #
      # Beyond installing the package it writes only the three files Orden leaves to
      # the reader in its settings folder, each of them optional: theme stylesheets,
      # custom.css, and snippets.json. Everything else in that folder is the app's
      # own state - window positions, history, what Settings saved - and is kept out
      # of here on purpose, since the app rewrites it while running.
      homeManagerModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.programs.orden;
          inherit (lib) mkOption types;
          system = pkgs.stdenv.hostPlatform.system;
          # Tauri's app_config_dir: XDG_CONFIG_HOME, then the bundle identifier.
          # The source build keeps the release's identifier, so both read the
          # same folder.
          folder = "ch.emilvinu.nib";
          # What themes.rs accepts as a theme's id, the file's name less `.css`.
          isId = id: builtins.stringLength id <= 39 && builtins.match "[a-z0-9][a-z0-9-]*" id != null;
          # The CSS itself, or a file holding it. Text first: `types.path` takes
          # any string starting with a slash, and a stylesheet may well open with
          # a comment.
          stylesheet = types.either types.lines types.path;
          file = value: if builtins.isString value then { text = value; } else { source = value; };
        in
        {
          options.programs.orden = {
            enable = lib.mkEnableOption "Orden, a markdown editor with realtime inline preview";

            package = mkOption {
              type = types.package;
              default =
                self.packages.${system}.default
                  or (throw "Orden's flake has packages for ${lib.concatStringsSep " and " systems} only, not ${system}");
              defaultText = lib.literalExpression "orden.packages.\${pkgs.stdenv.hostPlatform.system}.default";
              example = lib.literalExpression "orden.packages.\${pkgs.stdenv.hostPlatform.system}.orden-unstable";
              description = "The Orden to install: this flake's release by default.";
            };

            themes = mkOption {
              type = types.attrsOf stylesheet;
              default = { };
              example = lib.literalExpression "{ paper = ./paper.css; }";
              description = ''
                Theme stylesheets, each written to themes/<name>.css in Orden's
                settings folder and offered in Settings by that name, capitalised. A name is
                lower-case letters, digits and hyphens. Themes installed from inside
                the app go into the same folder and stay the app's.
              '';
            };

            customCss = mkOption {
              type = types.nullOr stylesheet;
              default = null;
              example = "body { font-size: 18px; }";
              description = ''
                custom.css, applied on top of whichever theme is active. Null leaves
                the file to the app, which starts it with a comment and nothing else.
              '';
            };

            snippets = mkOption {
              type = types.nullOr (types.attrsOf types.str);
              default = null;
              example = {
                todo = "- [ ] ";
              };
              description = ''
                snippets.json: abbreviations the editor completes while typing, each
                to the text it inserts. Null leaves the file to the app, which starts
                it with a couple of examples.
              '';
            };
          };

          config = lib.mkIf cfg.enable {
            assertions = [
              {
                assertion = pkgs.stdenv.hostPlatform.isLinux;
                message = "programs.orden: this flake packages Orden for Linux only.";
              }
            ]
            ++ map (name: {
              assertion = isId name;
              message = "programs.orden.themes.${name}: not a name Orden takes for a theme (lower-case letters, digits and hyphens, at most 39).";
            }) (builtins.attrNames cfg.themes);

            home.packages = [ cfg.package ];

            xdg.configFile =
              lib.mapAttrs' (name: css: lib.nameValuePair "${folder}/themes/${name}.css" (file css)) cfg.themes
              // lib.optionalAttrs (cfg.customCss != null) { "${folder}/custom.css" = file cfg.customCss; }
              // lib.optionalAttrs (cfg.snippets != null) {
                "${folder}/snippets.json".text = builtins.toJSON cfg.snippets;
              };
          };
        };

      apps = forEach (pkgs: {
        default = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          meta.description = "Orden, a markdown editor with realtime inline preview";
        };
        ${fromSource.pname} = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.${fromSource.pname};
          meta.description = "Orden compiled from the sources beside this flake";
        };
      });
    };
}
