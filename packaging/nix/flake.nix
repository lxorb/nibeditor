{
  # Orden for Nix: the program out of the release's .deb, run on nixpkgs' own
  # WebKitGTK, GTK and GStreamer, the way the AUR package runs it on Arch's.
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
  # and the latest build of main, as orden-edge, from the nix-edge branch:
  #
  #   nix profile install github:lxorb/orden/nix-edge?dir=packaging/nix
  #
  # On NixOS, as an input of the system's flake:
  #
  #   inputs.orden.url = "github:lxorb/orden?dir=packaging/nix";
  #   environment.systemPackages = [ inputs.orden.packages.${pkgs.system}.default ];
  #
  # or through `overlays.default`, which builds it out of the system's own nixpkgs.
  description = "Orden, a markdown editor with realtime inline preview";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      # Which build this flake installs. On main it is the latest release, moved by
      # .github/workflows/packaging-bump.yml after every one; on the `nix-edge`
      # branch it is the latest build of main, written there by nix-edge.yml as
      # `orden-edge`, so the two can sit in one profile side by side. Both run
      # scripts/bump-packaging.mjs; see packaging/linux.md.
      release = {
        pname = "orden";
        version = "0.15.0";
        # The release the .debs are attached to, and what they are called there.
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

      inherit (release) pname version;
      edge = pname != "orden";
      systems = builtins.attrNames debs;
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Built out of whichever nixpkgs it is handed: this flake's own for
      # `packages`, the system's for `overlays.default`. Nothing is compiled: the
      # .deb is unpacked, its program pointed at nixpkgs' libraries, and wrapped
      # in a shell script.
      mkOrden =
        pkgs:
        let
          inherit (debs.${pkgs.stdenv.hostPlatform.system}) suffix hash;

          # WebKitGTK plays audio and video through GStreamer, and these are the
          # only plugins it is let to load.
          gstPlugins = with pkgs.gst_all_1; [
            gstreamer
            gst-plugins-base
            gst-plugins-good
            gst-plugins-bad
            gst-libav
          ];
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

          buildInputs =
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
            ++ gstPlugins;

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
              --set GST_PLUGIN_SYSTEM_PATH_1_0 ${pkgs.lib.makeSearchPath "lib/gstreamer-1.0" gstPlugins} \
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
    in
    {
      packages = forEach (
        pkgs:
        let
          orden = mkOrden pkgs;
        in
        {
          ${pname} = orden;
          default = orden;
        }
        # What the package was called before 0.15, for a profile that names it.
        // pkgs.lib.optionalAttrs (!edge) { nib = orden; }
      );

      overlays.default = final: _prev: { ${pname} = mkOrden final; };

      apps = forEach (pkgs: {
        default = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          meta.description = "Orden, a markdown editor with realtime inline preview";
        };
      });
    };
}
