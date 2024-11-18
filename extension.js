/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';


const GITHUB_BASE_API_URL = 'https://api.github.com/repos/';
const DEFAULT_POLL_INTERVAL = 60; // seconds

const DebugIndicator = GObject.registerClass(
class DebugIndicator extends PanelMenu.Button {
    constructor(extension) {
      super()
      this.extension = extension
    }
    _init() {
        super._init(0.5, _('Debugging Indicator'));

        this.add_child(new St.Icon({
            icon_name: 'weather-tornado-symbolic',
            style_class: 'system-status-icon',
        }));

        this.menu.addAction(_('Check for GH notifications'), () => {
            this.extension.pollGithub().catch(error => {
                console.warn(`[GITHUB_NOTIFIER_EXTENSION] Error polling GitHub: ${error}`);
            });

            this.extension.pollGithubIssues().catch(error => {
                console.warn(`[GITHUB_NOTIFIER_EXTENSION] Error polling GitHub: ${error}`);
            });
        })

        this.menu.addAction(_('Preferences'), () => this.extension.openPreferences())
    }
});

export default class GithubNotifierExtension extends Extension {
    constructor(data) {
        super(data);
        this._httpSession = null;
        this._notificationSource = null;
        this._sourceId = null;
        this._pollInterval = DEFAULT_POLL_INTERVAL;
        this._lastEventID = '';
        this._lastIssueEventID = '';
        this.indicator = null;

        this._settings = this.getSettings()
    }

    enable() {
        this._httpSession = new Soup.Session();

        // the indicator is for debugging only.
        this._indicator = new DebugIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        const settings = this.getSettings()
        settings.bind('show-indicator', this._indicator, 'visible', Gio.SettingsBindFlags.DEFAULT);

        this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._pollInterval, () => {
            this.pollGithub().catch(error => {
                console.warn(`[GITHUB_NOTIFIER_EXTENSION] Error polling GitHub: ${error}`);
            });

            this.pollGithubIssues().catch(error => {
                console.warn(`[GITHUB_NOTIFIER_EXTENSION] Error polling GitHub: ${error}`);
            });
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }


    async pollGithub() {
        const apiKey = this._settings.get_string('github-token')
        let message = Soup.Message.new('GET', `${this._apiUrl()}/events`);
        message.request_headers.append('User-Agent', 'Gnome-Notifier');
        message.request_headers.append('Accept', 'application/vnd.github+json');
        if (apiKey != '') {
          message.request_headers.append('Authorization', `Bearer ${this._apiKey}`);
        }
        message.request_headers.append('X-GitHub-Api-Version', '2022-11-28');
        try {
            const bytes = await this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (message.get_status() === Soup.Status.OK) {
                const data = bytes.get_data();

                let jsonData = JSON.parse(new TextDecoder().decode(data));
                this._processEvents(jsonData);
            } else {
                console.warn(`[GITHUB_NOTIFIER_EXTENSION] HTTP request failed with status: ${message.status_code}`);
            }

        } catch (error) {
            console.error(`[GITHUB_NOTIFIER_EXTENSION] Error in pollGithub: ${error}`);
        }
    }

    async _processEvents(events) {
        for (let event of events) {
            if (event.id === this._lastEventID) {
                console.debug(`[GITHUB_NOTIFIER_EXTENSION] Not adding notification with id ${event.id} since we already shewed it. It was a: ${event.type} by ${event.actor.login}`);
                break;
            }

            let title, body, url;

            console.debug(`[GITHUB_NOTIFIER_EXTENSION] Processing event type: ${event.type}`)
            switch (event.type) {
                case 'PushEvent':
                    title = `Commit by ${event.actor.login}`;
                    body = event.payload.commits[0].message;
                    url = event.payload.commits[0].url;
                    break;
                case 'PullRequestReviewEvent':
                    title = `PR \#${event.payload.pull_request.number} review ${event.payload.action} by ${event.actor.login}`;
                    body = event.payload.review.body;
                    url = event.payload.review.html_url;
                    break;
                case 'PullRequestReviewCommentEvent':
                    title = `PR \#${event.payload.pull_request.number} review comment ${event.payload.action} by ${event.actor.login}`;
                    body = event.payload.comment.body;
                    url = event.payload.comment.html_url;
                    break;

                case 'PullRequestEvent':
                    title = `PR \#${event.payload.pull_request.number} ${event.payload.action} by ${event.actor.login}`;
                    body = event.payload.pull_request.title;
                    url = event.payload.pull_request.html_url;
                    break;
                case 'IssueCommentEvent':
                    title = `New comment by ${event.actor.login}`;
                    body = event.payload.comment.body;
                    url = event.payload.comment.html_url;
                    break;
                default:
                    console.debug(`[GITHUB_NOTIFIER_EXTENSION] ${event.type} not supported`);
                    continue;
            }

            this._createNotification(title, body, url);
            if (this._getNotificationSource().count === 3){
              // Stop early, since otherwise we'll replace the first notications (most recent) with the last ones (oldest)
              break;
            }
        }

        if (events.length > 0) {
            this._lastEventID = events[0].id;
        }
    }

    async pollGithubIssues() {
        const apiKey = this._settings.get_string('github-token')
        let message = Soup.Message.new('GET', `${this._apiUrl()}/issues/events`);
        message.request_headers.append('User-Agent', 'Gnome-Notifier');
        message.request_headers.append('Accept', 'application/vnd.github+json');
        if (apiKey != '') {
            message.request_headers.append('Authorization', `Bearer ${this._apiKey}`);
        }
        message.request_headers.append('X-GitHub-Api-Version', '2022-11-28');
        try {
            const bytes = await this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (message.status_code === Soup.Status.OK) {
                const data = bytes.get_data();

                let jsonData = JSON.parse(new TextDecoder().decode(data));
                this._processIssueEvents(jsonData);

            } else {
                console.warn(`[GITHUB_NOTIFIER_EXTENSION] HTTP request failed with status: ${message.status_code}`);
            }

        } catch (error) {
            console.error(`[GITHUB_NOTIFIER_EXTENSION] Error in pollGithubIssues: ${error}`);
        }
    }

    async _processIssueEvents(events) {
        for (let event of events) {
            if (event.id === this._lastIssueEventID) {
                console.debug(`[GITHUB_NOTIFIER_EXTENSION] Not adding issue notification with id ${event.id} since we already shewed it. It was an issue event: ${event.event} by ${event.actor.login}`);
                break;
            }

            let title, body, url;

            console.debug(`[GITHUB_NOTIFIER_EXTENSION] Processing issue event type: ${event.type}`)
            switch (event.event) {
                case 'head_ref_force_pushed':
                    title = `${event.actor.login} force pushed PR #${event.issue.number}`;
                    body = `${event.issue.title}`;
                    url = `${event.issue.html_url}`

                    if (this._getNotificationSource().notifications.some((existing_notification) => {
                        return existing_notification.title === title &&
                          existing_notification.body === body &&
                          existing_notification.url === url
                    })) {
                        console.debug(`[GITHUB_NOTIFIER_EXTENSION] Not adding issue notification with id ${event.id} since it is identical to an earlier one. It was an issue event: ${event.event} by ${event.actor.login}`);
                        continue;
                    }
                    break;
                default:
                    console.debug(`[GITHUB_NOTIFIER_EXTENSION] Issue ${event.event} event not supported`);
                    continue;
            }

            this._createNotification(title, body, url);
            if (this._getNotificationSource().count === 3){
              // Stop early, otherwise we'll replace the first notications (most recent) with the last ones (oldest)
              break;
            }
        }

        if (events.length > 0) {
            this._lastIssueEventID = events[0].id;
        }
    }

    _createNotification(title, body, url) {

    let source = this._getNotificationSource(); // I don't understand why I can't just use this rvalue below

    let notification = new MessageTray.Notification({
        source: source,
        title: title,
        body: body,
    });

    if(url) {
        notification.connect('activated', _ => {
            try {
                Gio.AppInfo.launch_default_for_uri(url, null);
            } catch (error) {
                console.error (`[GITHUB_NOTIFIER_EXTENSION] Error launching browser: ${error}`);
            }
        });

        notification.addAction(_('Open'), () => {
            try {
                Gio.AppInfo.launch_default_for_uri(url, null);
            } catch (error) {
                console.error(`[GITHUB_NOTIFIER_EXTENSION] Error launching browser: ${error}`);
            }
        });

        /*
        // bug fix for gnome 46.2, where notifs are not properly removed from
        // sources, should be fixed in 46.3

        notification.connect('destroy', _ => {
            notification.source.notifications.splice(
              notification.source.notifications.indexOf(notification),
              1
            );
        });
        */
    }

    source.addNotification(notification);
}

    _getNotificationSource() {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({
                // The source name (e.g. application name)
                title: _('Github Notifier'),
            });

            // Reset the notification source if it's destroyed
            this._notificationSource.connect('destroy', _source => {
                _notificationSource = null;
            });
            Main.messageTray.add(this._notificationSource);
        }

        return this._notificationSource;
    }

    _apiUrl() {
        return `${GITHUB_BASE_API_URL}${this._settings.get_string('github-repo')}`
    }
}
