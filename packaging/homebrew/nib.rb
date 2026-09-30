cask "nib" do
  version "0.10.0"
  sha256 "85b3fada253e4415935939ecaa22862f3f187e161277feaa0876edc3e610d980"

  url "https://github.com/lxorb/nibeditor/releases/download/v#{version}/Nib-#{version}-macos-universal.dmg",
      verified: "github.com/lxorb/nibeditor/"
  name "nibeditor"
  desc "Markdown editor that styles formatting in place instead of showing syntax"
  homepage "https://nibeditor.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :ventura"

  app "Nib.app"

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
    Nib is not notarized by Apple, so Gatekeeper refuses the quarantined copy
    Homebrew installs by default. Install it without the quarantine flag:

      brew install --cask --no-quarantine lxorb/tap/nib

  EOS
end
