{
  # Nib for Nix. The AppImage is wrapped rather than rebuilt: Tauri's AppImage
  # already carries WebKitGTK and its web process, so nothing has to be patched
  # in from nixpkgs beyond the FHS environment appimageTools sets up.
  #
  # This is not the nixpkgs package - it is a flake anyone can install from
  # directly, without waiting on a nixpkgs review:
  #
  #   nix profile install github:lxorb/nibeditor?dir=packaging/nix
  #   nix run github:lxorb/nibeditor?dir=packaging/nix
  description = "nibeditor, a markdown editor with realtime inline preview";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      version = "0.13.0";

      # One AppImage per architecture, from the release the version names.
      appimages = {
        x86_64-linux = {
          suffix = "x64";
          hash = "sha256-4h6SLV1U1QZQFEXPUDMUAU/mKkhf1Q+1an9qTloK5FQ=";
        };
        aarch64-linux = {
          suffix = "arm64";
          hash = "sha256-htrDrIUU71Og3jdh7Yca7Ox9kw+AtqfDlckwb2hmPgQ=";
        };
      };

      systems = builtins.attrNames appimages;
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system} system);
    in
    {
      packages = forEach (
        pkgs: system:
        let
          inherit (appimages.${system}) suffix hash;

          src = pkgs.fetchurl {
            url = "https://github.com/lxorb/nibeditor/releases/download/v${version}/Nib-${version}-linux-${suffix}.AppImage";
            inherit hash;
          };

          # Unpacked once so the .desktop entry and the icons can be installed
          # into the profile, which is what makes Nib show up in a launcher.
          contents = pkgs.appimageTools.extract {
            pname = "nib";
            inherit version src;
          };

          nib = pkgs.appimageTools.wrapType2 {
            pname = "nib";
            inherit version src;

            # pandoc is deliberately not pulled in: it is only needed for
            # importing and exporting DOCX and friends, Nib hides that when it
            # is missing, and it would roughly double the closure. Anyone who
            # wants it can add pandoc to their own profile.
            extraInstallCommands = ''
              install -Dm644 ${./nib.desktop} $out/share/applications/nib.desktop
              for size in 32 128; do
                install -Dm644 \
                  ${contents}/usr/share/icons/hicolor/"$size"x"$size"/apps/nib.png \
                  $out/share/icons/hicolor/"$size"x"$size"/apps/nib.png
              done
              install -Dm644 \
                ${contents}/usr/share/icons/hicolor/256x256@2/apps/nib.png \
                $out/share/icons/hicolor/256x256/apps/nib.png
            '';

            meta = {
              description = "Markdown editor with realtime inline preview";
              homepage = "https://nibeditor.com";
              downloadPage = "https://github.com/lxorb/nibeditor/releases";
              changelog = "https://github.com/lxorb/nibeditor/releases/tag/v${version}";
              license = nixpkgs.lib.licenses.agpl3Only;
              mainProgram = "nib";
              platforms = systems;
              sourceProvenance = [ nixpkgs.lib.sourceTypes.binaryNativeCode ];
            };
          };
        in
        {
          inherit nib;
          default = nib;
        }
      );

      apps = forEach (
        pkgs: system: rec {
          nib = {
            type = "app";
            program = "${self.packages.${system}.nib}/bin/nib";
          };
          default = nib;
        }
      );
    };
}
