export interface HomepageWidget {
	id:           string;
	position_id:  string;
	widget_type:  string;
	title:        string | null;
	config:       Record<string, unknown>;
	sort_order:   number;
	enabled:      boolean;
	visibility:   { audience?: 'all' | 'guests' | 'members'; roles?: string[]; start_date?: string; end_date?: string };
	width:        string;
	mobile_height: string | null;
	hide_mobile:  boolean;
	hide_tablet:  boolean;
}

export interface HomepagePosition {
	id:          string;
	label:       string;
	layout:      string;
	max_widgets: number | null;
	sort_order:  number;
	widgets:     HomepageWidget[];
}

export interface HomepageData {
	positions: HomepagePosition[];
}
