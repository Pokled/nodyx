import type { WidgetPlugin } from './_types'
import TwitchStream from '../widgets/TwitchStream.svelte'

const plugin: WidgetPlugin = {
	id:        'twitch-stream',
	label:     'Twitch Stream',
	icon:      '📺',
	desc:      'Embed Twitch player avec habillage Nodyx — pseudo configurable, chat optionnel, bordure gradient animée.',
	family:    'media',
	phase:     1,
	component: TwitchStream,
	schema: [
		{
			key: 'channel', type: 'text', label: 'Chaîne Twitch',
			placeholder: 'pokled  ou  https://twitch.tv/pokled',
			required: true,
			hint: 'Pseudo ou URL complète — les deux fonctionnent.',
		},
		{
			key: 'layout', type: 'select', label: 'Disposition',
			default: 'video-only',
			options: [
				{ value: 'video-only',         label: 'Vidéo seule' },
				{ value: 'video-chat',         label: 'Vidéo + chat à droite (desktop)' },
				{ value: 'video-chat-bottom',  label: 'Vidéo + chat en bas' },
			],
			hint: 'Le chat passe en dessous sur mobile dans tous les cas.',
		},
		{
			key: 'height', type: 'number', label: 'Hauteur du player (px)',
			default: 378, min: 240, max: 720,
			hint: 'Ratio 16/9 recommandé : 378 pour 672 de large.',
		},
		{
			key: 'theme', type: 'select', label: 'Thème du player',
			default: 'dark',
			options: [
				{ value: 'dark',  label: 'Sombre' },
				{ value: 'light', label: 'Clair' },
			],
		},
		{
			key: 'autoplay', type: 'boolean', label: 'Autoplay',
			default: false,
			hint: 'Respecte la politique navigateur — forcé à muted si autoplay.',
		},
		{
			key: 'muted', type: 'boolean', label: 'Muet au démarrage',
			default: true,
		},
		{
			key: 'show_header', type: 'boolean', label: 'Afficher le header Nodyx',
			default: true,
			hint: 'Barre du haut avec logo Twitch, pseudo et bouton "Ouvrir".',
		},
		{
			key: 'accent_color', type: 'color', label: 'Couleur d\'accent',
			default: '#9146FF',
			hint: 'Violet Twitch par défaut. Change-la pour matcher ta charte.',
		},
		// ── Fallback catégorie (optionnel, nécessite credentials Twitch côté serveur) ──
		{
			key: 'fallback_category', type: 'text', label: 'Stream de secours quand la chaîne est offline',
			placeholder: 'Ex: Software and Game Development',
			hint: 'Si ta chaîne n\'est pas en live, on diffuse à la place le stream le plus regardé d\'une catégorie Twitch (ex: un jeu, un thème).',
			details:
				'Comment ça marche\n\n' +
				'Quand ta chaîne est offline, le widget affiche automatiquement à la place le stream le plus regardé de la catégorie indiquée ici. Pratique pour ne jamais avoir un cadre vide sur ta homepage.\n\n' +
				'Que mettre dans le champ\n\n' +
				'Soit le nom exact d\'une catégorie Twitch — par exemple "Software and Game Development", "Just Chatting", "League of Legends".\n\n' +
				'Soit l\'URL complète de la catégorie copiée depuis Twitch — par exemple https://www.twitch.tv/directory/category/software-and-game-development. Le widget extrait le bon nom automatiquement.\n\n' +
				'Pré-requis côté serveur (action admin)\n\n' +
				'Cette fonctionnalité interroge l\'API Twitch pour trouver le stream le plus regardé de la catégorie. Il faut donc déclarer une application Twitch puis ajouter ses identifiants au fichier nodyx-core/.env :\n\n' +
				'TWITCH_CLIENT_ID=xxxxxxxxxxxx\nTWITCH_CLIENT_SECRET=xxxxxxxxxxxx\n\n' +
				'Inscription gratuite sur https://dev.twitch.tv/console/apps. Sans ces identifiants, ce champ reste sans effet et le player affichera "offline" quand ta chaîne ne stream pas.',
		},
		{
			key: 'fallback_language', type: 'select', label: 'Langue du stream de secours',
			default: 'any',
			options: [
				{ value: 'any', label: 'Toutes langues'   },
				{ value: 'fr',  label: 'Français'         },
				{ value: 'en',  label: 'English'          },
				{ value: 'es',  label: 'Español'          },
				{ value: 'de',  label: 'Deutsch'          },
				{ value: 'it',  label: 'Italiano'         },
				{ value: 'pt',  label: 'Português'        },
				{ value: 'nl',  label: 'Nederlands'       },
				{ value: 'ja',  label: '日本語'            },
				{ value: 'ko',  label: '한국어'            },
				{ value: 'zh',  label: '中文'              },
			],
			hint: 'Filtre les streams de secours par langue. Choisis "Français" pour ne proposer que des streams francophones.',
		},
	],
}

export default plugin
