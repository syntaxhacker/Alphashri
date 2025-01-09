def get_comparison_template(bg_color, text_color, tab_buttons_html, tab_content_html):
    """Return the HTML template for strategy comparison"""
    return f"""
    <!DOCTYPE html>
    <html>
        <head>
            <meta charset="utf-8">
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body {{
                    background-color: {bg_color};
                    margin: 0;
                    padding: 20px;
                    font-family: Arial, sans-serif;
                }}
                .tab {{
                    overflow: hidden;
                    background-color: #333;
                    position: fixed;
                    top: 20px;
                    left: 20px;
                    z-index: 1000;
                    border-radius: 4px;
                }}
                .tab button {{
                    background-color: inherit;
                    float: left;
                    border: none;
                    outline: none;
                    cursor: pointer;
                    padding: 14px 16px;
                    transition: 0.3s;
                    color: {text_color};
                    font-size: 16px;
                }}
                .tab button:hover {{
                    background-color: #555;
                }}
                .tab button.active {{
                    background-color: #4CAF50;
                }}
                .tabcontent {{
                    display: none;
                    padding-top: 60px;
                    height: calc(100vh - 80px);
                }}
                .tabcontent.active {{
                    display: block;
                }}
            </style>
        </head>
        <body>
            <div class="tab">
                {tab_buttons_html}
            </div>
            {tab_content_html}
            <script>
                function openStrategy(evt, strategyName) {{
                    var i, tabcontent, tablinks;
                    
                    tabcontent = document.getElementsByClassName("tabcontent");
                    for (i = 0; i < tabcontent.length; i++) {{
                        tabcontent[i].style.display = "none";
                    }}
                    
                    tablinks = document.getElementsByClassName("tablinks");
                    for (i = 0; i < tablinks.length; i++) {{
                        tablinks[i].className = tablinks[i].className.replace(" active", "");
                    }}
                    
                    document.getElementById(strategyName).style.display = "block";
                    evt.currentTarget.className += " active";
                    
                    // Trigger resize for Plotly
                    window.dispatchEvent(new Event('resize'));
                }}
                
                // Show first tab by default
                document.addEventListener('DOMContentLoaded', function() {{
                    document.querySelector('.tablinks').click();
                }});
            </script>
        </body>
    </html>
    """

def get_single_strategy_template():
    """Return the HTML template for single strategy plot"""
    return """
    <!DOCTYPE html>
    <html>
        <head>
            <style>
                body {{
                    background-color: #000000;
                    margin: 0;
                    padding: 0;
                }}
                ::-webkit-scrollbar {{
                    width: 12px;
                    height: 12px;
                }}
                ::-webkit-scrollbar-track {{
                    background: #000000;
                }}
                ::-webkit-scrollbar-thumb {{
                    background: #333333;
                    border-radius: 6px;
                }}
                ::-webkit-scrollbar-thumb:hover {{
                    background: #555555;
                }}
            </style>
        </head>
        <body>
            {plot_html}
        </body>
    </html>
    """ 