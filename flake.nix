{
  inputs = {
    nixpkgs.url = "nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        libraries = with pkgs; [
          openssl
        ];

        rustVersion = (builtins.fromTOML (builtins.readFile ./rust-toolchain.toml)).toolchain.channel;
        rustToolchain = pkgs.rust-bin.stable.${rustVersion}.default.override {
          extensions = [ "rust-src" "rust-analyzer" ];
        };

        packages = with pkgs; [
          git

          # node
          (nodePackages.yarn.override { withNode = false; })
          nodejs_22

          # rust
          rustToolchain
          cargo-deny
          cargo-edit
          cargo-watch
          bacon

          # server build deps
          curl
          wget
          pkg-config
          openssl
        ];

        genericShellConfig = {
          buildInputs = packages;

          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";

          shellHook = ''
            export LD_LIBRARY_PATH=${
              pkgs.lib.makeLibraryPath libraries
            }:$LD_LIBRARY_PATH
          '';
        };

      in {
        devShells.default = pkgs.mkShell genericShellConfig;

      });
}
