cask "annzarro" do
  arch arm: "arm64", intel: "x64"

  version "0.5.1"
  sha256 arm:   "e4bfa0e94c8990b859984c0fd7103a8ccc809c7f7bfbb805074a022b2cc18291",
         intel: "91bfcb9a6c5c62fb5ebf035bf72a5f30229c94647c4667203fc260a22f4d41aa"

  url "https://github.com/settylab/annzarro/releases/download/v#{version}/AnnZarro-#{version}-macos-#{arch}.dmg"
  name "AnnZarro"
  desc "Viewer for single-cell AnnData stored as zarr or h5ad"
  homepage "https://github.com/settylab/annzarro"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Set to true once the app updates itself (electron-updater ships). One-line change here
  # and in packaging/homebrew/annzarro.rb.template; then Homebrew leaves upgrades to the app.
  auto_updates false
  depends_on macos: :ventura

  app "AnnZarro.app"

  # Not removed: ~/annzarro-data, the user's datasets and saved panel sets.
  zap trash: [
    "~/.annzarro",
    "~/.config/annzarro",
    "~/Library/Application Support/AnnZarro",
    "~/Library/Application Support/annzarro-desktop",
    "~/Library/Caches/AnnZarro",
    "~/Library/Caches/annzarro-desktop",
    "~/Library/Caches/com.annzarro.desktop",
    "~/Library/Logs/AnnZarro",
    "~/Library/Preferences/com.annzarro.desktop.plist",
    "~/Library/Saved Application State/com.annzarro.desktop.savedState",
  ]
end
