{
  # Orden for Nix. The AppImage is wrapped rather than rebuilt: Tauri's AppImage
  # already carries WebKitGTK and its web process, so what nixpkgs adds is only the
  # FHS environment appimageTools sets up, and the few things the AppImage leaves to
  # the system (GStreamer's plugins, for audio and video in a note).
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

      # One AppImage per architecture, from the release the version names.
      appimages = {
        x86_64-linux = {
          suffix = "x64";
          hash = "sha256-u5KuH+CozgJ1TFuc/Ig6OHwgt9ylS16cs9G/jq2i3Uk=";
        };
        aarch64-linux = {
          suffix = "arm64";
          hash = "sha256-/N4z63ADqOsCYVQX2EusoJxJ4o2tV8NEyzUAjiwdqZY=";
        };
      };

      systems = builtins.attrNames appimages;
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Built out of whichever nixpkgs it is handed: this flake's own for
      # `packages`, the system's for `overlays.default`.
      mkOrden =
        pkgs:
        let
          inherit (appimages.${pkgs.stdenv.hostPlatform.system}) suffix hash;

          src = pkgs.fetchurl {
            url = "https://github.com/lxorb/orden/releases/download/v${version}/Orden-${version}-linux-${suffix}.AppImage";
            inherit hash;
          };

          # Unpacked once, and run from here, so the AppImage's own start script can
          # be corrected and the .desktop entry and the icons installed into the
          # profile, which is what makes Orden show up in a launcher.
          #
          # The script forces GDK_BACKEND=x11 on everyone, which puts a Wayland
          # session on Xwayland; without it GTK takes Wayland when there is one and
          # X11 when there is not, and a GDK_BACKEND the user set still counts.
          #
          # The GStreamer it bundles is Ubuntu 22.04's 1.20, which refuses every
          # plugin newer than itself, and it bundles no plugins: taking it out lets
          # WebKit load nixpkgs' GStreamer and plugins, the same version as each
          # other.
          contents = pkgs.appimageTools.extract {
            pname = "orden";
            inherit version src;
            postExtract = ''
              chmod -R u+w $out
              substituteInPlace $out/apprun-hooks/linuxdeploy-plugin-gtk.sh \
                --replace-fail 'export GDK_BACKEND=x11' ':'
              rm $out/usr/lib/libgst*-1.0.so*
            '';
          };
        in
        pkgs.appimageTools.wrapAppImage {
          pname = "orden";
          inherit version;
          src = contents;

          # WebKitGTK plays audio and video through GStreamer. Wayland, EGL and
          # D-Bus are in appimageTools' own list already, and named here as well
          # because a window depends on them.
          #
          # pandoc is deliberately not pulled in: it is only needed for importing
          # and exporting DOCX and friends, Orden hides that when it is missing, and
          # it would roughly double the closure. Anyone who wants it can add pandoc
          # to their own profile.
          extraPkgs =
            pkgs:
            (with pkgs.gst_all_1; [
              gstreamer
              gst-plugins-base
              gst-plugins-good
              gst-plugins-bad
              gst-libav
            ])
            ++ (with pkgs; [
              wayland
              libxkbcommon
              libGL
              libglvnd
              dbus
            ]);

          # GStreamer looks for its plugins in its own store path; in the FHS
          # environment they are all in /usr/lib.
          #
          # WebKitGTK's DMA-BUF renderer wants a libgbm that matches the bundled
          # WebKit, and nixpkgs' Mesa is not that one: the window comes up blank on
          # many GPUs. Off unless the user says otherwise, the same as the snap.
          profile = ''
            export GST_PLUGIN_SYSTEM_PATH_1_0=/usr/lib/gstreamer-1.0
            export WEBKIT_DISABLE_DMABUF_RENDERER="''${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
          '';

          # The program inside is still called nib, and so was this package until
          # 0.15; `nib` stays as a second name for whoever types it.
          extraInstallCommands = ''
            ln -s orden $out/bin/nib
            install -Dm644 ${./orden.desktop} $out/share/applications/orden.desktop
            for size in 32 128; do
              install -Dm644 \
                ${contents}/usr/share/icons/hicolor/"$size"x"$size"/apps/nib.png \
                $out/share/icons/hicolor/"$size"x"$size"/apps/orden.png
            done
            # A plain 256x256 image, filed by Tauri under a scale-2 directory.
            install -Dm644 \
              ${contents}/usr/share/icons/hicolor/256x256@2/apps/nib.png \
              $out/share/icons/hicolor/256x256/apps/orden.png
          '';

          passthru = { inherit contents; };

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
