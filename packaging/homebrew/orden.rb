cask "orden" do
  version "0.15.0"
  sha256 "065e28ad689b202670fdc20ff4a7cb70ad327d5cf81a061cc8c2e48cd2d644e5"

  url "https://github.com/lxorb/orden/releases/download/v#{version}/Orden-#{version}-macos-universal.dmg",
      verified: "github.com/lxorb/orden/"
  name "Orden"
  name "nibeditor"
  desc "Markdown editor that styles formatting in place instead of showing syntax"
  homepage "https://orden.so/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :ventura"

  app "Orden.app"

  uninstall quit: "ch.emilvinu.nib"

  zap trash: [
    "~/Library/Application Support/ch.emilvinu.nib",
    "~/Library/Caches/ch.emilvinu.nib",
    "~/Library/HTTPStorages/ch.emilvinu.nib",
    "~/Library/Preferences/ch.emilvinu.nib.plist",
    "~/Library/Saved Application State/ch.emilvinu.nib.savedState",
    "~/Library/WebKit/ch.emilvinu.nib",
  ]

  caveats <<~EOS
    Orden is not notarized by Apple, so Gatekeeper refuses the quarantined copy
    Homebrew installs by default. Install it without the quarantine flag:

      brew install --cask --no-quarantine lxorb/tap/orden

  EOS
end
