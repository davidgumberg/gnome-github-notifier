set export
atuuid := "githubnotifier@davidgumberg"
dotuuid := replace(atuuid, "@", ".")

default: install

install: pack
    gnome-extensions install build/${atuuid}.com.shell-extension.zip --force

alias b := pack
alias build := pack
pack:
    mkdir -p build/
    gnome-extensions pack --schema schemas/org.gnome.shell.extensions.$dotuuid.gschema.xml -o build/ --force

debug:
    #!/bin/sh -e

    # Each line of a justfile recipe gets a fresh environment by default, the
    # way around this is a shebang recipe.

    # export G_MESSAGES_DEBUG=all
    export SHELL_DEBUG=all
    export MUTTER_DEBUG_DUMMY_MODE_SPECS=1466x768

    dbus-run-session -- gnome-shell --nested --wayland

all: pack install debug
