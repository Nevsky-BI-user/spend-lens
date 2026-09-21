# Deneb Vega-Lite Recipes

Each recipe contains a complete Specification and Config.
Replace field names with your Power BI model columns/measures.

---

## Table of Contents

1. [Column Chart with Data Labels](#1-column-chart-with-data-labels)
2. [Horizontal Bar Chart (sorted)](#2-horizontal-bar-chart-sorted)
3. [Line Chart with Area Fill](#3-line-chart-with-area-fill)
4. [Actual vs Budget Bar Chart with Variance](#4-actual-vs-budget-bar-chart-with-variance)
5. [KPI Card (text marks only)](#5-kpi-card-text-marks-only)
6. [Heatmap Matrix](#6-heatmap-matrix)
7. [Bullet Chart](#7-bullet-chart)
8. [Waterfall Chart](#8-waterfall-chart)
9. [Lollipop Chart](#9-lollipop-chart)
10. [Small Multiples (Facet)](#10-small-multiples-facet)
11. [Donut / Arc Chart](#11-donut--arc-chart)
12. [Scatter Plot with Size and Color](#12-scatter-plot-with-size-and-color)
13. [Stacked Bar Chart with Labels](#13-stacked-bar-chart-with-labels)
14. [Diverging Bar Chart (positive/negative)](#14-diverging-bar-chart-positivenegative)
15. [Sparkline-style Line Chart](#15-sparkline-style-line-chart)

---

## 1. Column Chart with Data Labels

Fields needed: `Category` (nominal), `Sales` (quantitative measure).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "layer": [
    {
      "mark": {
        "type": "bar",
        "tooltip": true,
        "cornerRadiusTopLeft": 4,
        "cornerRadiusTopRight": 4
      },
      "encoding": {
        "color": {"value": "#4472C4"},
        "opacity": {
          "condition": {
            "test": {"field": "__selected__", "equal": "off"},
            "value": 0.3
          },
          "value": 1
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "dy": -10,
        "fontSize": 11,
        "fontWeight": "bold"
      },
      "encoding": {
        "text": {
          "field": "Sales",
          "type": "quantitative",
          "format": "$#,0",
          "formatType": "pbiFormat"
        }
      }
    }
  ],
  "encoding": {
    "x": {
      "field": "Category",
      "type": "nominal",
      "sort": "-y",
      "axis": {"labelAngle": 0}
    },
    "y": {
      "field": "Sales",
      "type": "quantitative",
      "axis": {
        "format": "$#,0,.0K",
        "formatType": "pbiFormat"
      }
    },
    "tooltip": [
      {"field": "Category", "type": "nominal"},
      {"field": "Sales", "type": "quantitative", "format": "$#,0", "formatType": "pbiFormat"}
    ]
  }
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "grid": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 12,
    "titleFontSize": 14,
    "titleColor": "#252423"
  },
  "axisX": {
    "domain": true
  },
  "axisY": {
    "labelPadding": 10
  }
}
```

---

## 2. Horizontal Bar Chart (sorted)

Fields: `Category` (nominal), `Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "layer": [
    {
      "mark": {
        "type": "bar",
        "tooltip": true,
        "cornerRadiusTopRight": 6,
        "cornerRadiusBottomRight": 6,
        "height": {"band": 0.7}
      },
      "encoding": {
        "color": {"value": "#4472C4"},
        "opacity": {
          "condition": {
            "test": {"field": "__selected__", "equal": "off"},
            "value": 0.3
          },
          "value": 1
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "align": "left",
        "dx": 5,
        "fontSize": 11
      },
      "encoding": {
        "text": {
          "field": "Value",
          "type": "quantitative",
          "format": "#,0",
          "formatType": "pbiFormat"
        }
      }
    }
  ],
  "encoding": {
    "y": {
      "field": "Category",
      "type": "nominal",
      "sort": "-x",
      "axis": {"title": null}
    },
    "x": {
      "field": "Value",
      "type": "quantitative",
      "axis": null
    }
  }
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "grid": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 12
  }
}
```

---

## 3. Line Chart with Area Fill

Fields: `Date` (temporal), `Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "layer": [
    {
      "mark": {
        "type": "area",
        "opacity": 0.3,
        "color": "#4472C4",
        "tooltip": true
      },
      "encoding": {
        "y": {"field": "Value", "type": "quantitative"}
      }
    },
    {
      "mark": {
        "type": "line",
        "strokeWidth": 2.5,
        "color": "#4472C4",
        "interpolate": "monotone"
      },
      "encoding": {
        "y": {"field": "Value", "type": "quantitative"}
      }
    },
    {
      "mark": {
        "type": "point",
        "filled": true,
        "size": 40,
        "color": "#4472C4"
      },
      "encoding": {
        "y": {"field": "Value", "type": "quantitative"},
        "opacity": {
          "condition": {
            "test": {"field": "__selected__", "equal": "off"},
            "value": 0.3
          },
          "value": 1
        }
      }
    }
  ],
  "encoding": {
    "x": {
      "field": "Date",
      "type": "temporal",
      "timeUnit": "yearmonth",
      "axis": {
        "format": "%b %Y",
        "labelAngle": -45
      }
    },
    "tooltip": [
      {"field": "Date", "type": "temporal", "timeUnit": "yearmonth", "title": "Period"},
      {"field": "Value", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"}
    ]
  }
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11,
    "titleFontSize": 13,
    "titleColor": "#252423"
  },
  "axisY": {
    "grid": true,
    "gridDash": [2, 4],
    "gridOpacity": 0.3,
    "labelPadding": 10
  },
  "axisX": {
    "grid": false,
    "domain": true
  }
}
```

---

## 4. Actual vs Budget Bar Chart with Variance

Fields: `Category` (nominal), `Actual` (quantitative), `Budget` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "transform": [
    {"calculate": "datum.Actual - datum.Budget", "as": "Variance"},
    {"calculate": "datum.Variance >= 0 ? '#4CAF50' : '#F44336'", "as": "varColor"},
    {"calculate": "datum.Variance >= 0 ? '+' + pbiFormat(datum.Variance, '#,0') : pbiFormat(datum.Variance, '#,0')", "as": "varLabel"}
  ],
  "encoding": {
    "x": {
      "field": "Category",
      "type": "nominal",
      "axis": {"labelAngle": 0, "title": null}
    }
  },
  "layer": [
    {
      "mark": {
        "type": "bar",
        "width": {"band": 0.6},
        "tooltip": true
      },
      "encoding": {
        "y": {"field": "Actual", "type": "quantitative"},
        "color": {"value": "#4472C4"},
        "opacity": {
          "condition": {
            "test": {"field": "__selected__", "equal": "off"},
            "value": 0.3
          },
          "value": 1
        },
        "tooltip": [
          {"field": "Category", "type": "nominal"},
          {"field": "Actual", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"},
          {"field": "Budget", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"},
          {"field": "Variance", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"}
        ]
      }
    },
    {
      "mark": {
        "type": "tick",
        "color": "#333333",
        "thickness": 3,
        "width": {"band": 0.8}
      },
      "encoding": {
        "y": {"field": "Budget", "type": "quantitative"}
      }
    },
    {
      "mark": {
        "type": "text",
        "dy": -12,
        "fontSize": 10
      },
      "encoding": {
        "y": {"field": "Actual", "type": "quantitative"},
        "text": {"field": "varLabel", "type": "nominal"},
        "color": {"field": "varColor", "type": "nominal", "scale": null}
      }
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "grid": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 12
  },
  "axisY": {
    "format": "#,0",
    "formatType": "pbiFormat",
    "labelPadding": 10
  }
}
```

---

## 5. KPI Card (text marks only)

Fields: `KPI_Title` (nominal, a measure returning text), `KPI_Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "layer": [
    {
      "mark": {
        "type": "text",
        "fontSize": 14,
        "fontWeight": "normal",
        "color": "#666666",
        "align": "center",
        "y": 25
      },
      "encoding": {
        "text": {"field": "KPI_Title", "type": "nominal"}
      }
    },
    {
      "mark": {
        "type": "text",
        "fontSize": 36,
        "fontWeight": "bold",
        "color": "#252423",
        "align": "center",
        "y": 70
      },
      "encoding": {
        "text": {
          "field": "KPI_Value",
          "type": "quantitative",
          "format": "$#,0",
          "formatType": "pbiFormat"
        }
      }
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "background": "transparent"
}
```

---

## 6. Heatmap Matrix

Fields: `XCategory` (nominal), `YCategory` (nominal), `Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "layer": [
    {
      "mark": {
        "type": "rect",
        "tooltip": true
      },
      "encoding": {
        "color": {
          "field": "Value",
          "type": "quantitative",
          "scale": {
            "scheme": "blues"
          },
          "legend": {"title": "Value"}
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "fontSize": 11
      },
      "encoding": {
        "text": {
          "field": "Value",
          "type": "quantitative",
          "format": ".1f"
        },
        "color": {
          "condition": {
            "test": "datum.Value > 70",
            "value": "white"
          },
          "value": "#333333"
        }
      }
    }
  ],
  "encoding": {
    "x": {
      "field": "XCategory",
      "type": "nominal",
      "axis": {"title": null, "labelAngle": 0}
    },
    "y": {
      "field": "YCategory",
      "type": "nominal",
      "axis": {"title": null}
    }
  }
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "domain": false,
    "grid": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11
  }
}
```

---

## 7. Bullet Chart

Fields: `Category` (nominal), `Actual` (quantitative), `Target` (quantitative), `MaxScale` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "transform": [
    {"calculate": "datum.MaxScale * 0.3", "as": "Poor"},
    {"calculate": "datum.MaxScale * 0.7", "as": "Satisfactory"}
  ],
  "encoding": {
    "y": {
      "field": "Category",
      "type": "nominal",
      "axis": {"title": null}
    }
  },
  "layer": [
    {
      "mark": {"type": "bar", "height": {"band": 0.9}, "color": "#E0E0E0"},
      "encoding": {"x": {"field": "MaxScale", "type": "quantitative", "axis": null}}
    },
    {
      "mark": {"type": "bar", "height": {"band": 0.9}, "color": "#CCCCCC"},
      "encoding": {"x": {"field": "Satisfactory", "type": "quantitative"}}
    },
    {
      "mark": {"type": "bar", "height": {"band": 0.9}, "color": "#B0B0B0"},
      "encoding": {"x": {"field": "Poor", "type": "quantitative"}}
    },
    {
      "mark": {"type": "bar", "height": {"band": 0.5}, "color": "#333333", "tooltip": true},
      "encoding": {
        "x": {"field": "Actual", "type": "quantitative"},
        "opacity": {
          "condition": {"test": {"field": "__selected__", "equal": "off"}, "value": 0.3},
          "value": 1
        }
      }
    },
    {
      "mark": {"type": "tick", "color": "#F44336", "thickness": 3, "height": {"band": 1}},
      "encoding": {"x": {"field": "Target", "type": "quantitative"}}
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "grid": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11
  }
}
```

---

## 8. Waterfall Chart

Fields: `Step` (nominal, ordered), `Value` (quantitative), `SortOrder` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "transform": [
    {
      "window": [{"op": "sum", "field": "Value", "as": "RunningTotal"}],
      "sort": [{"field": "SortOrder", "order": "ascending"}]
    },
    {"calculate": "datum.RunningTotal - datum.Value", "as": "PrevTotal"},
    {"calculate": "datum.Value >= 0 ? '#4CAF50' : '#F44336'", "as": "barColor"},
    {"calculate": "min(datum.RunningTotal, datum.PrevTotal)", "as": "y0"},
    {"calculate": "max(datum.RunningTotal, datum.PrevTotal)", "as": "y1"}
  ],
  "encoding": {
    "x": {
      "field": "Step",
      "type": "nominal",
      "sort": {"field": "SortOrder", "order": "ascending"},
      "axis": {"labelAngle": -45, "title": null}
    }
  },
  "layer": [
    {
      "mark": {"type": "bar", "tooltip": true, "width": {"band": 0.7}},
      "encoding": {
        "y": {"field": "y0", "type": "quantitative", "title": "Value"},
        "y2": {"field": "y1"},
        "color": {"field": "barColor", "type": "nominal", "scale": null}
      }
    },
    {
      "mark": {"type": "text", "dy": -10, "fontSize": 10},
      "encoding": {
        "y": {"field": "y1", "type": "quantitative"},
        "text": {
          "field": "Value",
          "type": "quantitative",
          "format": "+#,0;-#,0",
          "formatType": "pbiFormat"
        },
        "color": {"field": "barColor", "type": "nominal", "scale": null}
      }
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11
  },
  "axisY": {
    "grid": true,
    "gridDash": [2, 4],
    "gridOpacity": 0.3,
    "format": "#,0",
    "formatType": "pbiFormat",
    "labelPadding": 10
  }
}
```

---

## 9. Lollipop Chart

Fields: `Category` (nominal), `Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "encoding": {
    "y": {
      "field": "Category",
      "type": "nominal",
      "sort": "-x",
      "axis": {"title": null}
    },
    "x": {
      "field": "Value",
      "type": "quantitative",
      "axis": {"title": null}
    }
  },
  "layer": [
    {
      "mark": {"type": "rule", "color": "#4472C4", "strokeWidth": 2},
      "encoding": {
        "x": {"datum": 0},
        "x2": {"field": "Value"}
      }
    },
    {
      "mark": {
        "type": "point",
        "filled": true,
        "size": 120,
        "color": "#4472C4",
        "tooltip": true
      },
      "encoding": {
        "opacity": {
          "condition": {"test": {"field": "__selected__", "equal": "off"}, "value": 0.3},
          "value": 1
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "align": "left",
        "dx": 12,
        "fontSize": 11,
        "color": "#333"
      },
      "encoding": {
        "text": {
          "field": "Value",
          "type": "quantitative",
          "format": "#,0",
          "formatType": "pbiFormat"
        }
      }
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "grid": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11
  }
}
```

---

## 10. Small Multiples (Facet)

Fields: `Category` (nominal), `Date` (temporal), `Value` (quantitative), `FacetField` (nominal).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "facet": {
    "field": "FacetField",
    "type": "nominal",
    "columns": 3,
    "title": null
  },
  "spec": {
    "width": 200,
    "height": 120,
    "mark": {
      "type": "line",
      "strokeWidth": 2,
      "color": "#4472C4",
      "interpolate": "monotone"
    },
    "encoding": {
      "x": {
        "field": "Date",
        "type": "temporal",
        "timeUnit": "yearmonth",
        "axis": {"format": "%b", "labelAngle": 0, "title": null}
      },
      "y": {
        "field": "Value",
        "type": "quantitative",
        "axis": {
          "title": null,
          "format": "#,0",
          "formatType": "pbiFormat"
        }
      }
    }
  }
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "header": {
    "labelFontSize": 13,
    "labelFontWeight": "bold",
    "labelColor": "#252423"
  },
  "axis": {
    "ticks": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 10,
    "grid": true,
    "gridDash": [2, 4],
    "gridOpacity": 0.3
  }
}
```

---

## 11. Donut / Arc Chart

Fields: `Category` (nominal), `Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "layer": [
    {
      "mark": {
        "type": "arc",
        "innerRadius": 60,
        "outerRadius": 100,
        "tooltip": true
      },
      "encoding": {
        "theta": {"field": "Value", "type": "quantitative", "stack": true},
        "color": {
          "field": "Category",
          "type": "nominal",
          "scale": {
            "range": ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5"]
          },
          "legend": {"title": null}
        },
        "opacity": {
          "condition": {"test": {"field": "__selected__", "equal": "off"}, "value": 0.3},
          "value": 1
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "radiusOffset": 20,
        "fontSize": 11
      },
      "encoding": {
        "theta": {"field": "Value", "type": "quantitative", "stack": true},
        "text": {"field": "Value", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"},
        "color": {"value": "#333"}
      }
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "legend": {
    "labelFontSize": 11,
    "symbolSize": 100,
    "orient": "bottom",
    "direction": "horizontal"
  }
}
```

---

## 12. Scatter Plot with Size and Color

Fields: `Entity` (nominal), `XMeasure` (quantitative), `YMeasure` (quantitative), `SizeMeasure` (quantitative), `ColorCategory` (nominal).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "mark": {
    "type": "point",
    "filled": true,
    "tooltip": true,
    "opacity": 0.8
  },
  "encoding": {
    "x": {
      "field": "XMeasure",
      "type": "quantitative",
      "axis": {"title": "X Metric", "format": "#,0", "formatType": "pbiFormat"}
    },
    "y": {
      "field": "YMeasure",
      "type": "quantitative",
      "axis": {"title": "Y Metric", "format": "#,0", "formatType": "pbiFormat"}
    },
    "size": {
      "field": "SizeMeasure",
      "type": "quantitative",
      "scale": {"range": [50, 500]}
    },
    "color": {
      "field": "ColorCategory",
      "type": "nominal"
    },
    "tooltip": [
      {"field": "Entity", "type": "nominal"},
      {"field": "XMeasure", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"},
      {"field": "YMeasure", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"},
      {"field": "SizeMeasure", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"}
    ],
    "opacity": {
      "condition": {"test": {"field": "__selected__", "equal": "off"}, "value": 0.2},
      "value": 0.8
    }
  }
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11,
    "titleFontSize": 13,
    "titleColor": "#252423",
    "grid": true,
    "gridDash": [2, 4],
    "gridOpacity": 0.2,
    "domain": false
  },
  "legend": {
    "labelFontSize": 11,
    "symbolSize": 100
  }
}
```

---

## 13. Stacked Bar Chart with Labels

Fields: `Category` (nominal), `Segment` (nominal), `Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "layer": [
    {
      "mark": {
        "type": "bar",
        "tooltip": true,
        "width": {"band": 0.7}
      },
      "encoding": {
        "color": {
          "field": "Segment",
          "type": "nominal",
          "legend": {"title": null}
        },
        "opacity": {
          "condition": {"test": {"field": "__selected__", "equal": "off"}, "value": 0.3},
          "value": 1
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "fontSize": 10,
        "color": "white"
      },
      "encoding": {
        "text": {
          "field": "Value",
          "type": "quantitative",
          "format": "#,0",
          "formatType": "pbiFormat"
        },
        "color": {"value": "white"}
      }
    }
  ],
  "encoding": {
    "x": {
      "field": "Category",
      "type": "nominal",
      "axis": {"labelAngle": 0, "title": null}
    },
    "y": {
      "field": "Value",
      "type": "quantitative",
      "stack": "zero",
      "axis": {
        "format": "#,0",
        "formatType": "pbiFormat",
        "title": null
      }
    }
  }
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "grid": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11
  },
  "axisX": {"domain": true},
  "legend": {
    "orient": "top",
    "direction": "horizontal",
    "labelFontSize": 11
  }
}
```

---

## 14. Diverging Bar Chart (positive/negative)

Fields: `Category` (nominal), `Variance` (quantitative, can be negative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "transform": [
    {"calculate": "datum.Variance >= 0 ? '#4CAF50' : '#F44336'", "as": "barColor"}
  ],
  "encoding": {
    "y": {
      "field": "Category",
      "type": "nominal",
      "sort": {"field": "Variance", "order": "descending"},
      "axis": {"title": null}
    },
    "x": {
      "field": "Variance",
      "type": "quantitative",
      "axis": {
        "format": "+#,0;-#,0",
        "formatType": "pbiFormat",
        "title": null
      }
    }
  },
  "layer": [
    {
      "mark": {
        "type": "bar",
        "height": {"band": 0.7},
        "tooltip": true,
        "cornerRadiusTopRight": 4,
        "cornerRadiusBottomRight": 4,
        "cornerRadiusTopLeft": 4,
        "cornerRadiusBottomLeft": 4
      },
      "encoding": {
        "color": {"field": "barColor", "type": "nominal", "scale": null},
        "opacity": {
          "condition": {"test": {"field": "__selected__", "equal": "off"}, "value": 0.3},
          "value": 1
        }
      }
    },
    {
      "mark": {"type": "rule", "color": "#333", "strokeWidth": 1},
      "encoding": {
        "x": {"datum": 0}
      }
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {
    "ticks": false,
    "grid": false,
    "domain": false,
    "labelColor": "#605E5C",
    "labelFontSize": 11
  },
  "axisX": {
    "grid": true,
    "gridDash": [2, 4],
    "gridOpacity": 0.3
  }
}
```

---

## 15. Sparkline-style Line Chart

Minimal line with no axes — fits in narrow spaces.

Fields: `Date` (temporal), `Value` (quantitative).

**Specification:**
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "dataset"},
  "transform": [
    {
      "joinaggregate": [
        {"op": "max", "field": "Value", "as": "maxVal"},
        {"op": "min", "field": "Value", "as": "minVal"}
      ]
    },
    {
      "window": [{"op": "rank", "as": "rank"}],
      "sort": [{"field": "Date", "order": "descending"}]
    },
    {"calculate": "datum.rank == 1", "as": "isLast"}
  ],
  "layer": [
    {
      "mark": {
        "type": "line",
        "strokeWidth": 2,
        "color": "#4472C4",
        "interpolate": "monotone"
      },
      "encoding": {
        "x": {"field": "Date", "type": "temporal", "axis": null},
        "y": {"field": "Value", "type": "quantitative", "axis": null, "scale": {"zero": false}}
      }
    },
    {
      "transform": [{"filter": "datum.isLast"}],
      "mark": {
        "type": "point",
        "filled": true,
        "size": 50,
        "color": "#4472C4"
      },
      "encoding": {
        "x": {"field": "Date", "type": "temporal"},
        "y": {"field": "Value", "type": "quantitative"}
      }
    }
  ]
}
```

**Config:**
```json
{
  "view": {"stroke": "transparent"},
  "font": "Segoe UI",
  "axis": {"grid": false, "domain": false, "ticks": false}
}
```
