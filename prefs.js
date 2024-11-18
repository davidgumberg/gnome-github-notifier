import Adw from "gi://Adw";
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {ExtensionPreferences, gettext as _} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const GithubNotifierPreferencesPage = GObject.registerClass(
class GithubNotifierPreferencesPage extends Adw.PreferencesPage {
  _init(settings) {
    super._init({
        icon_name: 'system-run-symbolic',
        name: 'Github API preferences'
    });

    const appearanceGroup = new Adw.PreferencesGroup({
        title: 'Appearance',
        description: ('Configure the appearance of this extension'),
    });

    const showIndicatorSwitch = new Adw.SwitchRow({
        title: ('Show Indicator'),
        subtitle: ('Whether to show the panel indicator'),
    });

    settings.bind('show-indicator', showIndicatorSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    appearanceGroup.add(showIndicatorSwitch);
    this.add(appearanceGroup)

    const repoGroup = new Adw.PreferencesGroup({
        title: 'Github Repo',
        description: ('The Github repository you wish to track notifications for ("owner/repository")'),
    });

    const repo = new Adw.EntryRow({
      title: "owner/repository",
    });

    settings.bind('github-repo', repo, 'text', Gio.SettingsBindFlags.DEFAULT);
    repoGroup.add(repo);
    this.add(repoGroup)

    const tokenGroup = new Adw.PreferencesGroup({
        title: 'Github API Token',
        description: _('Optionally add a token to get notifications for private repos'),
    });

    const token = new Adw.PasswordEntryRow({
      title: "Github API Token",
      text: settings.get_string("github-token")
    });

    settings.bind('github-token', token, 'text', Gio.SettingsBindFlags.DEFAULT);
    tokenGroup.add(token);
    this.add(tokenGroup);
  }
});

export default class GithubNotifierPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window.add(new GithubNotifierPreferencesPage(settings));
  }
}
