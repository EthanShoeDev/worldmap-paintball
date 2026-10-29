{
  description = "worldmap-paintball";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = {nixpkgs, ...}: let
    # shoemaker:begin bun
    # nixpkgs lags bun releases, so repoint the prebuilt release archives at
    # the version in package.json `packageManager` and the CI setup action.
    # bun ships binaries only, so this is a src swap and nothing is compiled.
    # Keep the three in lockstep.
    bunOverlay = _final: prev: {
      bun = prev.bun.overrideAttrs (finalAttrs: oldAttrs: {
        version = "1.4.4";
        __intentionallyOverridingVersion = true;
        passthru =
          oldAttrs.passthru
          // {
            sources = {
              "aarch64-darwin" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-darwin-aarch64.zip";
                hash = "sha256-wkDX8My5DCY6hJ/NsJt+5iYw2SE0jtaq/ahrnVd7xRA=";
              };
              "x86_64-darwin" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-darwin-x64.zip";
                hash = "sha256-UKNJH3Orwv6BZzFxqFdi07wswWgMzsrdmD3pmt93l34=";
              };
              "aarch64-linux" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-aarch64.zip";
                hash = "sha256-uqa7NvUdblhWHgK76oJQOKnfRU9nPW13bou/hvjHhQ4=";
              };
              "x86_64-linux" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-x64.zip";
                hash = "sha256-v4zL+ysLgBWeD5ptFcVTF63YB3U028YTCj7bUvzLOVw=";
              };
            };
          };
      });
    };
    # shoemaker:end bun
    forAllSystems = function:
      nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
        system:
          function (import nixpkgs {
            inherit system;
            overlays = [bunOverlay];
          })
      );
  in {
    formatter = forAllSystems (pkgs: pkgs.alejandra);

    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell {
        packages = with pkgs; [
          # shoemaker:begin packages
          bun
          nodejs_24
          # shoemaker:end packages
          # Project packages go below the region.
        ];
        shellHook = ''
          # shoemaker:begin shell-hook
          export TZ=UTC
          # shoemaker:end shell-hook
        '';
      };
    });
  };
}
