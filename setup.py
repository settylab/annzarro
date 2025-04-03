from setuptools import setup, find_packages

setup(
    name="annzarro",
    version="1.0.0",
    description="Python-based Single-Cell Data Visualization Tool",
    author="",
    author_email="",
    url="",
    packages=find_packages(),
    include_package_data=True,
    install_requires=[
        "flask>=2.0.0",
        "flask-cors>=3.0.0",
        "zarr>=2.13.0",
        "numpy>=1.20.0",
        "pandas>=1.3.0",
        "matplotlib>=3.4.0",
        "werkzeug>=2.0.0",
        "pyjwt>=2.0.0",
        "cryptography>=35.0.0",
        "numba>=0.53.0"
    ],
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-cov>=4.0.0",
            "pylint>=2.17.0",
        ],
    },
    python_requires=">=3.7",
    entry_points={
        "console_scripts": [
            "annzarro=annzarro.cli:main",
        ],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Science/Research",
        "Topic :: Scientific/Engineering :: Bio-Informatics",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
    ],
    test_suite="annzarro.tests",
)