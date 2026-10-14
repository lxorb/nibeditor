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
      # Moved after every release by .github/workflows/packaging-bump.yml, which
      # runs scripts/bump-packaging.mjs; see packaging/linux.md.
      version = "0.15.0";

      # One .deb per architecture, from the release the version names.
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

      systems = builtins.attrNames debs;
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Built out of whichever nixpkgs it is handed: this flake's own for
      # `packages`, the system's for `overlays.default`.
      mkOrden =
        pkgs:
        let
          inherit (debs.${pkgs.stdenv.hostPlatform.system}) suffix hash;
        in
        pkgs.stdenv.mkDerivation {
          pname = "orden";
          inherit version;

          src = pkgs.fetchurl {
            url = "https://github.com/lxorb/orden/releases/download/v${version}/Orden-${version}-linux-${suffix}.deb";
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
            # WebKitGTK plays audio and video through GStreamer;
            # wrapGAppsHook3 points it at these.
            ++ (with pkgs.gst_all_1; [
              gstreamer
              gst-plugins-base
              gst-plugins-good
              gst-plugins-bad
              gst-libav
            ]);

          dontConfigure = true;
          dontBuild = true;

          # The program keeps the name every install of it has had, nib, so `orden`
          # is a second name beside it. Tauri's own desktop entry is replaced with
          # the one beside this file, and its 256x256 icon, which it files under a
          # scale-2 directory, goes where a theme looks for it.
          installPhase = ''
            runHook preInstall
            install -Dm755 usr/bin/nib $out/bin/nib
            ln -s nib $out/bin/orden
            install -Dm644 ${./orden.desktop} $out/share/applications/orden.desktop
            for size in 32 128; do
              install -Dm644 usr/share/icons/hicolor/"$size"x"$size"/apps/nib.png \
                $out/share/icons/hicolor/"$size"x"$size"/apps/orden.png
            done
            install -Dm644 usr/share/icons/hicolor/256x256@2/apps/nib.png \
              $out/share/icons/hicolor/256x256/apps/orden.png
            runHook postInstall
          '';

          # The wrapper is a shell script rather than wrapGAppsHook3's own, for the
          # one thing a binary wrapper cannot do: WebKitGTK's DMA-BUF renderer is
          # what leaves a blank window on NVIDIA's own driver, so there, and only
          # there, it is turned off - unless the user has set it either way. Mesa
          # (Intel, AMD) keeps it. Links and attachments open with xdg-open.
          #
          # pandoc is deliberately not here: it is only needed for importing and
          # exporting DOCX and friends, Orden hides that when it is missing, and
          # anyone who wants it can add it to their own profile.
          dontWrapGApps = true;
          postFixup = ''
            mv $out/bin/nib $out/bin/.nib-wrapped
            makeShellWrapper $out/bin/.nib-wrapped $out/bin/nib \
              "''${gappsWrapperArgs[@]}" \
              --inherit-argv0 \
              --suffix PATH : ${pkgs.lib.makeBinPath [ pkgs.xdg-utils ]} \
              --run 'if [ -z "''${WEBKIT_DISABLE_DMABUF_RENDERER+set}" ] && [ -e /proc/driver/nvidia/version ]; then export WEBKIT_DISABLE_DMABUF_RENDERER=1; fi'
          '';

          meta = {
            description = "Markdown editor with realtime inline preview";
            homepage = "https://orden.so";
            downloadPage = "https://github.com/lxorb/orden/releases";
            changelog = "https://github.com/lxorb/orden/releases/tag/v${version}";
            license = pkgs.lib.licenses.agpl3Only;
            mainProgram = "orden";
            platforms = systems;
            sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
          };
        };
    in
    {
      packages = forEach (pkgs: rec {
        orden = mkOrden pkgs;
        default = orden;
        # What the package was called before 0.15, for a profile that names it.
        nib = orden;
      });

      overlays.default = final: _prev: { orden = mkOrden final; };

      apps = forEach (pkgs: rec {
        orden = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.orden}/bin/orden";
          meta.description = "Orden, a markdown editor with realtime inline preview";
        };
        default = orden;
      });
    };
}
